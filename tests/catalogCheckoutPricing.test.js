const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function setup(drugs) {
  let filter, fields;
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(require.resolve('../utils/catalogCheckoutPricing'), 'utf8'), {
    module, exports: module.exports,
    require(name) {
      assert.equal(name, '../models/Drug', 'Only the central catalog can supply checkout prices');
      return { find(value) { filter = value; return {
        select(value) { fields = value; return this; }, lean: async () => drugs,
      }; } };
    },
  });
  return { quote: module.exports.catalogCheckoutPricing, filter: () => filter, fields: () => fields };
}

test('checkout uses only central unit selling prices and excludes pharmacy/inventory prices', async () => {
  const service = setup([{ _id: 'aaaaaaaaaaaaaaaaaaaaaaaa', name: 'Medicine', unitSellingPrice: 25, price: 999, sellingPrice: 800 }]);
  const result = await service.quote([{ id: 'aaaaaaaaaaaaaaaaaaaaaaaa', name: 'Medicine', price: 0 }]);
  assert.equal(result[0].price, 25);
  assert.equal(service.filter().isActive, true);
  assert.equal(service.fields(), '_id name unitSellingPrice');
});

test('unknown and unpriced catalog entries remain unknown instead of falling back to pharmacy/client prices', async () => {
  const service = setup([{ _id: 'a', name: 'Unpriced', price: 99 }]);
  const result = await service.quote([{ id: 'a', name: 'Unpriced', price: 10 }, { name: 'Unknown' }]);
  assert.equal(result[0].price, null);
  assert.equal(result[1].price, null);
});

test('legacy names match exactly and ambiguous matches are not guessed', async () => {
  const service = setup([{ _id: 'a', name: 'Medicine (500mg)', unitSellingPrice: 10 }]);
  const result = await service.quote([{ name: 'Medicine (500mg)' }, { name: 'Medicine 250mg' }]);
  assert.equal(result[0].price, 10);
  assert.equal(result[1].price, null);
  const pattern = service.filter().$or[1].name.$in[0];
  assert.equal(pattern.test('Medicine (500mg)'), true);
  assert.equal(pattern.test('Medicine 500mg'), false);
  const ambiguous = setup([{ _id: 'a', name: 'Medicine', unitSellingPrice: 1 }, { _id: 'b', name: 'Medicine', unitSellingPrice: 2 }]);
  assert.equal((await ambiguous.quote([{ name: 'Medicine' }]))[0].price, null);
});

test('explicit central zero is preserved, invalid prices are unavailable and request sizes are bounded', async () => {
  for (const raw of [null, undefined, '', false, -1, Infinity, 'invalid']) {
    const service = setup([{ _id: 'a', name: 'Medicine', unitSellingPrice: raw }]);
    assert.equal((await service.quote([{ id: 'a', name: 'Medicine' }]))[0].price, null);
  }
  const service = setup([{ _id: 'a', name: 'Medicine', unitSellingPrice: 0 }]);
  assert.equal((await service.quote([{ id: 'a', name: 'Medicine' }]))[0].price, 0);
  for (const selection of [[], null, Array(101).fill({ name: 'Medicine' }), [{ name: { $ne: '' } }]]) {
    await assert.rejects(service.quote(selection), error => error.status === 400);
  }
});

test('order confirmation persists the central price and rejects a stale client total', async () => {
  const quote = setup([{ _id: 'aaaaaaaaaaaaaaaaaaaaaaaa', name: 'Medicine', unitSellingPrice: 25 }]).quote;
  const filename = require.resolve('../controllers/orderController');
  const module = { exports: {} };
  let saved;
  class Order {
    constructor(data) { Object.assign(this, data); }
    async save() { saved = this; }
  }
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), {
    module, exports: module.exports, console: { log() {}, error() {}, warn() {} },
    require(name) {
      if (name === '../models/Order') return Order;
      if (name === '../utils/catalogCheckoutPricing') return { catalogCheckoutPricing: quote };
      if (name === '../utils/patientOrderTotals') return require('../utils/patientOrderTotals');
      if (name === '../models/User') return { findOne: async () => ({ _id: 'pharmacy' }), findById: () => ({ lean: async () => ({ fullName: 'Patient' }) }) };
      if (name === '../models/Points') return { findOne: async () => { throw new Error('unrelated optional reward service'); } };
      if (name === '../models/Notification') return { create: async () => {} };
      return {};
    },
  });
  const submit = async (total, deliveryMethod = 'pickup') => {
    let result;
    await module.exports.createOrder({ user: { _id: 'patient' }, body: {
      pharmacyId: 'pharmacy', total, deliveryMethod, orderType: 'manual',
      items: [{ item: 'aaaaaaaaaaaaaaaaaaaaaaaa', onModel: 'Product', name: 'Medicine', quantity: 2, price: 999 }],
    } }, { status(code) { this.code = code; return this; }, json(body) { result = { code: this.code, body }; } });
    return result;
  };
  assert.equal((await submit(50)).code, 201);
  assert.equal(saved.total, 50);
  assert.equal(saved.items[0].price, 25);
  assert.equal((await submit(65, 'delivery')).code, 201);
  assert.equal(saved.subtotal, 50);
  assert.equal(saved.deliveryFee, 15);
  assert.equal(saved.deliveryFeeEstimated, true);
  assert.equal(saved.total, 65);
  saved = null;
  const stale = await submit(1998);
  assert.equal(stale.code, 409);
  assert.equal(stale.body.code, 'CATALOG_PRICE_CHANGED');
  assert.equal(saved, null);
});

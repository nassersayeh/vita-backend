const clients = {};

function subscribe(userId, res) {
  if (!userId) return;
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });
  res.write('\n');

  if (!clients[userId]) clients[userId] = new Set();
  clients[userId].add(res);

  reqClose(res, userId);
}

function reqClose(res, userId) {
  res.on('close', () => {
    if (clients[userId]) {
      clients[userId].delete(res);
      if (clients[userId].size === 0) delete clients[userId];
    }
  });
}

function publish(userId, event, data = {}) {
  try {
    if (!userId) return;
    const set = clients[userId];
    if (!set || set.size === 0) return;
    const payload = JSON.stringify(data);
    set.forEach((res) => {
      try {
        res.write(`event: ${event}\n`);
        res.write(`data: ${payload}\n\n`);
      } catch (err) {
        // ignore client write errors
      }
    });
  } catch (err) {
    console.error('SSE publish error', err);
  }
}

module.exports = { subscribe, publish };

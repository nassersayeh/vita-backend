const path = require('path');
const express = require('express');
// Serve local uploads first. Development can use the production copy of older
// prescription attachments when the shared database references non-local files.
exports.createUploadedFilesMiddleware = (root = path.join(__dirname, '..', 'uploads'), { fallbackOrigin } = {}) => {
  const serve = express.static(root, { fallthrough: false });
  const fallback = fallbackOrigin ? new URL(fallbackOrigin).origin : null;
  return (req, res, next) => serve(req, res, error => {
    if (!error || error.status !== 404 || !fallback || !['GET', 'HEAD'].includes(req.method)) return next(error);
    if (!/^\/prescriptions\/[a-z\d_-]+\.(?:png|jpe?g|gif|webp|pdf)$/i.test(req.path)) return next(error);
    // Avoid redirect loops if a deployed server points its fallback at itself.
    if (req.get('host')?.toLowerCase() === new URL(fallback).host.toLowerCase()) return next(error);
    res.set('Cache-Control', 'no-store');
    return res.redirect(302, `${fallback}/uploads${req.path}`);
  });
};

// req.flash(type, { msg }) stores a message in the session; the next render shows and clears it.
// Messages are translated when stored (req.t comes from the i18n middleware; English passthrough otherwise).
exports.flash = (req, res, next) => {
  req.flash = (type, message) => {
    const msg = message && req.t ? { ...message, msg: req.t(message.msg) } : message;
    return ((req.session.flash ||= {})[type] ||= []).push(msg);
  };
  const render = res.render.bind(res);
  res.render = (...args) => {
    res.locals.messages = req.session?.flash || {};
    if (req.session) delete req.session.flash;
    return render(...args);
  };
  next();
};

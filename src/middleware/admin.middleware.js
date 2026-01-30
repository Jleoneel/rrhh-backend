export function requireAdmin(req, res, next) {
  if (req.user.rol_sistema !== "ADMIN") {
    return res.status(403).json({ message: "Solo ADMIN" });
  }
  next();
}

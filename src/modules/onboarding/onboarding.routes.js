import { Router } from "express";
import { pool } from "../../db.js";
import { requireAuth } from "../../shared/middleware/auth.middleware.js";

const router = Router();

// Sirve tanto a FIRMANTE como a SERVIDOR: cada tour de bienvenida se filtra
// por tipo_usuario + su propio id, nunca por cargo (eso lo decide el
// frontend al elegir qué set de slides mostrar).
const usuarioActual = (req) => ({
  tipo_usuario: req.user.tipo_usuario,
  usuario_id:
    req.user.tipo_usuario === "SERVIDOR"
      ? req.user.servidor_id
      : req.user.firmante_id,
});

// GET /api/onboarding/:modulo → última versión que este usuario ya vio (0 si ninguna)
router.get("/:modulo", requireAuth, async (req, res) => {
  const { tipo_usuario, usuario_id } = usuarioActual(req);
  try {
    const { rows } = await pool.query(
      `SELECT version FROM core.onboarding_visto
       WHERE tipo_usuario = $1 AND usuario_id = $2 AND modulo = $3`,
      [tipo_usuario, usuario_id, req.params.modulo],
    );
    return res.json({ version: rows[0]?.version ?? 0 });
  } catch (err) {
    console.error("Error consultando onboarding_visto:", err);
    return res.status(500).json({ message: "Error consultando onboarding" });
  }
});

// PUT /api/onboarding/:modulo { version } → marca esa versión como vista
router.put("/:modulo", requireAuth, async (req, res) => {
  const { tipo_usuario, usuario_id } = usuarioActual(req);
  const version = parseInt(req.body.version, 10);
  if (!Number.isFinite(version)) {
    return res.status(400).json({ message: "version inválida" });
  }

  try {
    await pool.query(
      `INSERT INTO core.onboarding_visto (tipo_usuario, usuario_id, modulo, version)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (tipo_usuario, usuario_id, modulo)
       DO UPDATE SET version = GREATEST(core.onboarding_visto.version, EXCLUDED.version),
                     visto_en = now()`,
      [tipo_usuario, usuario_id, req.params.modulo, version],
    );
    return res.json({ message: "Registrado" });
  } catch (err) {
    console.error("Error guardando onboarding_visto:", err);
    return res.status(500).json({ message: "Error guardando onboarding" });
  }
});

export default router;

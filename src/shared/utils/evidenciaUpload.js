// Reglas compartidas para los adjuntos de evidencia de permisos (Calamidad
// Doméstica / Enfermedad), usadas por solicitudes-servidor.routes.js y
// solicitudes-firmante.routes.js — un solo lugar para no repetir el mismo
// límite/lista de formatos con valores que se puedan desincronizar.

export const MIMETYPES_EVIDENCIA_PERMITIDOS = {
  "application/pdf": ".pdf",
  "image/jpeg": ".jpg",
  "image/png": ".png",
};

export const TAMANO_MAXIMO_EVIDENCIA = 8 * 1024 * 1024; // 8 MB

export const filtroArchivoEvidencia = (req, file, cb) => {
  if (!MIMETYPES_EVIDENCIA_PERMITIDOS[file.mimetype]) {
    return cb(new Error("Solo se permiten archivos PDF, JPG o PNG"));
  }
  cb(null, true);
};

export const nombreArchivoEvidencia = (file) => {
  const extension = MIMETYPES_EVIDENCIA_PERMITIDOS[file.mimetype] || "";
  return `evidencia_${Date.now()}${extension}`;
};

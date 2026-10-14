import multer from "multer";

// Un error de multer (archivo muy grande, tipo no permitido) ocurre DENTRO
// del middleware upload.single()/upload.array(), antes de que el route
// handler y su propio try/catch lleguen a correr. Sin este wrapper, Express
// cae a su página de error por defecto — HTML con el stack trace completo,
// incluyendo rutas absolutas del servidor (node_modules, el repo entero).
export function conManejoErrorMulter(uploadMiddleware) {
  return (req, res, next) => {
    uploadMiddleware(req, res, (err) => {
      if (err instanceof multer.MulterError) {
        if (err.code === "LIMIT_FILE_SIZE") {
          return res
            .status(413)
            .json({ message: "El archivo supera el tamaño máximo permitido" });
        }
        return res.status(400).json({ message: "Error al subir el archivo" });
      }
      if (err) {
        return res.status(400).json({ message: err.message || "Error al subir el archivo" });
      }
      next();
    });
  };
}

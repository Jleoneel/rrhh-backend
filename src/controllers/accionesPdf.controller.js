import path from "path";
import fs from "fs";
import { pool } from "../db.js";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

export const generarPdfAccion = async (req, res) => {
  try {
    const { id } = req.params;
    const separarNombresApellidos = (nombreCompleto = "") => {
      const partes = nombreCompleto.trim().split(/\s+/);

      if (partes.length === 1) {
        return {
          nombres: partes[0],
          apellidos: "",
        };
      }
      if (partes.length === 2) {
        return {
          apellidos: partes[0],
          nombres: partes[1],
        };
      }

      return {
        apellidos: partes.slice(0, -2).join(" "),
        nombres: partes.slice(-2).join(" "),
      };
    };

    // Función para limpiar texto de caracteres no soportados por WinAnsi
    const limpiarTextoWinAnsi = (texto = "") => {
      if (!texto) return "";

      // Reemplazar caracteres especiales con sus equivalentes aproximados
      return texto
        .toString()
        .replace(/[áàäâã]/g, "a")
        .replace(/[éèëê]/g, "e")
        .replace(/[íìïî]/g, "i")
        .replace(/[óòöôõ]/g, "o")
        .replace(/[úùüû]/g, "u")
        .replace(/[ÁÀÄÂÃ]/g, "A")
        .replace(/[ÉÈËÊ]/g, "E")
        .replace(/[ÍÌÏÎ]/g, "I")
        .replace(/[ÓÒÖÔÕ]/g, "O")
        .replace(/[ÚÙÜÛ]/g, "U")
        .replace(/[¿]/g, "")
        .replace(/[¡]/g, "")
        .replace(/[""]/g, '"')
        .replace(/['']/g, "'")
        .replace(/[—–-]/g, "-")
        .replace(/[•]/g, "-")
        .replace(/\n/g, " ")
        .replace(/\r/g, " ")
        .replace(/\t/g, " ")
        .replace(/\s+/g, " ")
        .trim();
    };

    //QUERY (MODIFICADA PARA INCLUIR SITUACIÓN ACTUAL Y PROPUESTA)
    const result = await pool.query(
      `
      SELECT 
        ap.id,
        ap.fecha_elaboracion,
        ap.estado,
        ap.motivo,
        ap.rige_desde,
        ap.rige_hasta,
        tipo_accion_otro_detalle AS otro_detalle,
        codigo_elaboracion, 
        presento_declaracion_jurada,

        sv.nombres,
        sv.numero_identificacion AS cedula,
        sv.canton AS lugar_trabajo,  -- Obtener lugar_trabajo de servidor

        ta.nombre AS tipo_accion,
        ta.requiere_propuesta,

        -- Datos de situación actual con JOINs para obtener nombres
        pia.nombre AS proceso_institucional_actual,
        nga.nombre AS nivel_gestion_actual,
        u.nombre AS unidad_organica,
        d.nombre AS denominacion_puesto,
        e.nombre AS escala_ocupacional,
        p.grado,
        p.rmu_puesto,
        p.partida_individual,
        p.modalidad_laboral,

        -- Datos de situación propuesta con JOINs para obtener nombres
        up.nombre AS unidad_organica_propuesta,
        dp.nombre AS denominacion_puesto_propuesta,
        ep.nombre AS escala_ocupacional_propuesta,
        prop.lugar_trabajo AS lugar_trabajo_propuesta,
        prop.grado AS grado_propuesta,
        prop.rmu_puesto AS rmu_propuesta,
        prop.partida_individual AS partida_propuesta,
        pip.nombre AS proceso_institucional_propuesta,
        ngp.nombre AS nivel_gestion_propuesta
      FROM core.accion_personal ap
      JOIN core.servidor sv ON sv.id = ap.servidor_id
      JOIN core.tipo_accion ta ON ta.id = ap.tipo_accion_id
      -- JOIN con la tabla de puesto actual (usando puesto_id de la acción)
      LEFT JOIN core.puesto p ON p.id = ap.puesto_id
      -- JOINs con catálogos para situación actual
      LEFT JOIN core.unidad_organica u ON u.id = p.unidad_organica_id
      LEFT JOIN core.denominacion_puesto d ON d.id = p.denominacion_puesto_id
      LEFT JOIN core.escala_ocupacional e ON e.id = p.escala_ocupacional_id
      -- JOIN con situación propuesta
      LEFT JOIN core.accion_situacion_propuesta prop ON prop.accion_id = ap.id
      -- JOINs con catálogos para situación propuesta
      LEFT JOIN core.unidad_organica up ON up.id = prop.unidad_organica_id
      LEFT JOIN core.denominacion_puesto dp ON dp.id = prop.denominacion_puesto_id
      LEFT JOIN core.escala_ocupacional ep ON ep.id = prop.escala_ocupacional_id
      LEFT JOIN core.proceso_institucional pip ON pip.id = prop.proceso_institucional_id
      LEFT JOIN core.nivel_gestion ngp ON ngp.id = prop.nivel_gestion_id
      LEFT JOIN core.proceso_institucional pia
  ON pia.id = ap.proceso_institucional_id
  LEFT JOIN core.nivel_gestion nga
  ON nga.id = ap.nivel_gestion_id
      
      WHERE ap.id = $1
      LIMIT 1;
      `,
      [id],
    );

    // Consultar firmantes para los cargos específicos
    const firmanteResult = await pool.query(
      `
  SELECT 
    f.nombre,
    c.nombre AS cargo
  FROM core.firmante f
  JOIN core.cargo c ON c.id = f.cargo_id
  WHERE c.nombre = 'GERENTE HOSPITALARIO ENCARGADO'
  AND c.activo = true
  LIMIT 1;
  `,
    );
    const firmanteResult2 = await pool.query(
      `
  SELECT 
    f.nombre,
    c.nombre AS cargo
  FROM core.firmante f
  JOIN core.cargo c ON c.id = f.cargo_id
  WHERE c.nombre = 'RESPONSABLE DE LA UATH'
  AND c.activo = true
  LIMIT 1;
  `,
    );

    // Consultar datos del usuario autenticado para mostrar en el PDF
    const usuarioResult = await pool.query(
      `
  SELECT f.nombre, c.nombre AS cargo
  FROM core.firmante f
  JOIN core.cargo c ON c.id = f.cargo_id
  WHERE f.id = $1
  LIMIT 1;
  `,
      [req.user.firmante_id],
    );

    // Obtener datos del usuario autenticado
    const usuario = usuarioResult.rows[0] || {};
    const nombreUsuario = limpiarTextoWinAnsi(usuario.nombre || "");
    const cargoUsuario = limpiarTextoWinAnsi(usuario.cargo || "");

    if (result.rows.length === 0) {
      return res.status(404).json({ message: "Acción no encontrada" });
    }

    const accion = result.rows[0];

    // Limpiar todos los textos que se van a mostrar en el PDF
    const accionLimpia = {
      ...accion,
      nombres: limpiarTextoWinAnsi(accion.nombres),
      cedula: limpiarTextoWinAnsi(accion.cedula),
      tipo_accion: limpiarTextoWinAnsi(accion.tipo_accion),
      unidad_organica: limpiarTextoWinAnsi(accion.unidad_organica),
      denominacion_puesto: limpiarTextoWinAnsi(accion.denominacion_puesto),
      escala_ocupacional: limpiarTextoWinAnsi(accion.escala_ocupacional),
      lugar_trabajo: limpiarTextoWinAnsi(accion.lugar_trabajo),
      partida_individual: limpiarTextoWinAnsi(accion.partida_individual),
      motivo: limpiarTextoWinAnsi(accion.motivo),
      otro_detalle: limpiarTextoWinAnsi(accion.otro_detalle),
      codigo_elaboracion: limpiarTextoWinAnsi(accion.codigo_elaboracion),
      unidad_organica_propuesta: limpiarTextoWinAnsi(
        accion.unidad_organica_propuesta,
      ),
      denominacion_puesto_propuesta: limpiarTextoWinAnsi(
        accion.denominacion_puesto_propuesta,
      ),
      escala_ocupacional_propuesta: limpiarTextoWinAnsi(
        accion.escala_ocupacional_propuesta,
      ),
      lugar_trabajo_propuesta: limpiarTextoWinAnsi(
        accion.lugar_trabajo_propuesta,
      ),
      partida_propuesta: limpiarTextoWinAnsi(accion.partida_propuesta),
      modalidad_laboral_propuesta: limpiarTextoWinAnsi(
        accion.modalidad_laboral_propuesta,
      ),
      proceso_institucional_propuesta: limpiarTextoWinAnsi(
        accion.proceso_institucional_propuesta,
      ),
      nivel_gestion_propuesta: limpiarTextoWinAnsi(
        accion.nivel_gestion_propuesta,
      ),
      modalidad_laboral: limpiarTextoWinAnsi(accion.modalidad_laboral),
    };

    const firmante = firmanteResult.rows[0] || {};

    const nombreFirmante = limpiarTextoWinAnsi(firmante.nombre || "");
    const cargoFirmante = limpiarTextoWinAnsi(firmante.cargo || "");

    const firmante2 = firmanteResult2.rows[0] || {};

    const nombreFirmante2 = limpiarTextoWinAnsi(firmante2.nombre || "");
    const cargoFirmante2 = limpiarTextoWinAnsi(firmante2.cargo || "");

    const { nombres, apellidos } = separarNombresApellidos(
      accionLimpia.nombres,
    );

    // cargar plantilla
    const pdfPath = path.resolve("src/pdf/plantilla_accion_personal1.pdf");
    const pdfBytes = fs.readFileSync(pdfPath);

    const pdfDoc = await PDFDocument.load(pdfBytes);
    const page = pdfDoc.getPages()[0];

    // Obtener o crear la segunda página
    let page2 = pdfDoc.getPages()[1];
    if (!page2) {
      page2 = pdfDoc.addPage();
    }

    // Configurar fuente
    const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const tipoAccion = accionLimpia.tipo_accion;

    const drawCenteredText = ({
      page,
      text = "",
      centerX,
      y,
      font,
      size = 9,
    }) => {
      if (!text) return;
      const textWidth = font.widthOfTextAtSize(text, size);
      const x = centerX - textWidth / 2;

      page.drawText(text, {
        x,
        y,
        size,
        font,
        color: rgb(0, 0, 0),
      });
    };

    const drawWrappedText = ({
      page,
      text = "",
      x,
      y,
      maxWidth,
      lineHeight = 12,
      font,
      size = 9,
    }) => {
      if (!text) return;

      // Asegurar que el texto no tenga saltos de línea
      const textoLimpio = text
        .replace(/\n/g, " ")
        .replace(/\r/g, " ")
        .replace(/\s+/g, " ")
        .trim();
      const words = textoLimpio.split(" ");
      let line = "";
      let cursorY = y;

      for (let i = 0; i < words.length; i++) {
        const testLine = line + (line ? " " : "") + words[i];
        const width = font.widthOfTextAtSize(testLine, size);

        if (width > maxWidth && line !== "") {
          page.drawText(line, {
            x,
            y: cursorY,
            size,
            font,
            color: rgb(0, 0, 0),
          });
          line = words[i];
          cursorY -= lineHeight;
        } else {
          line = testLine;
        }
      }

      if (line) {
        page.drawText(line, {
          x,
          y: cursorY,
          size,
          font,
          color: rgb(0, 0, 0),
        });
      }
    };

    const tipos = {
      Ingreso: { x: 132.3, y: 659.8 },
      Reingreso: { x: 132.3, y: 650 },
      Restitucion: { x: 132.3, y: 641 },
      Reintegro: { x: 132.3, y: 632 },
      Ascenso: { x: 132.3, y: 622 },
      Traslado: { x: 132.3, y: 612 },
      Traspaso: { x: 262.8, y: 659.8 },
      "Cambio Administrativo": { x: 262.8, y: 650 },
      "Intercambio Voluntario": { x: 262.8, y: 641 },
      Licencia: { x: 262.8, y: 632 },
      "Comision de servicios": { x: 262.8, y: 622 },
      Sanciones: { x: 262.8, y: 612 },
      "Incremento RMU": { x: 397.5, y: 659.8 },
      Subrogacion: { x: 397.5, y: 650 },
      Encargo: { x: 397.5, y: 641 },
      "Cesacion de Funciones": { x: 397.5, y: 632 },
      Destitucion: { x: 397.5, y: 622 },
      Vacaciones: { x: 397.5, y: 612 },
      "Revision Clasificacion Puesto": { x: 522.3, y: 659.8 },
      Otro: { x: 522.3, y: 650 },
    };

    const presentoDeclaracionJurada = {
      true: { x: 302, y: 590.4 },
      false: { x: 387.2, y: 590.4 },
    };

    // Buscar coincidencia exacta o parcial para el tipo de acción
    const tipoAccionKey = Object.keys(tipos).find(
      (key) =>
        tipoAccion.toLowerCase().includes(key.toLowerCase()) ||
        key.toLowerCase().includes(tipoAccion.toLowerCase()),
    );

    if (tipoAccionKey) {
      page.drawText("X", {
        x: tipos[tipoAccionKey].x,
        y: tipos[tipoAccionKey].y,
        size: 7,
        font,
        color: rgb(0, 0, 0),
      });
    }

    // escribir datos
    page.drawText(limpiarTextoWinAnsi(nombres) || "", {
      x: 380,
      y: 738,
      size: 9,
      font,
      color: rgb(0, 0, 0),
    });

    page.drawText(limpiarTextoWinAnsi(apellidos) || "", {
      x: 105,
      y: 738,
      size: 9,
      font,
      color: rgb(0, 0, 0),
    });

    page.drawText(accionLimpia.cedula || "", {
      x: 194,
      y: 693,
      size: 8,
      font,
      color: rgb(0, 0, 0),
    });

    page.drawText("CEDULA", {
      x: 75,
      y: 693,
      size: 8,
      font,
      color: rgb(0, 0, 0),
    });

    // Formatear fechas de manera segura
    const formatearFecha = (fecha) => {
      if (!fecha) return "";
      try {
        return new Date(fecha)
          .toLocaleDateString("es-EC", {
            day: "2-digit",
            month: "2-digit",
            year: "numeric",
          })
          .replace(/\//g, "-");
      } catch (e) {
        return "";
      }
    };

    page.drawText(formatearFecha(accion.fecha_elaboracion), {
      x: 420,
      y: 755,
      size: 8,
      font,
      color: rgb(0, 0, 0),
    });

    page.drawText(formatearFecha(accion.rige_desde), {
      x: 338,
      y: 693,
      size: 7,
      font,
      color: rgb(0, 0, 0),
    });

    if (accion.rige_hasta) {
      page.drawText(formatearFecha(accion.rige_hasta), {
        x: 460,
        y: 693,
        size: 7,
        font,
        color: rgb(0, 0, 0),
      });
    }

    drawWrappedText({
      page,
      text: accionLimpia.motivo || "",
      x: 40,
      y: 555,
      maxWidth: 500,
      font,
      size: 9,
      lineHeight: 12,
    });

    drawWrappedText({
      page,
      text: accionLimpia.otro_detalle || "",
      x: 419,
      y: 641,
      maxWidth: 125,
      font,
      size: 7,
      lineHeight: 10,
    });

    page.drawText(accionLimpia.codigo_elaboracion || "", {
      x: 444,
      y: 781,
      size: 6,
      font,
      color: rgb(0, 0, 0),
    });

    // situación actual
    drawCenteredText({
      page,
      text: accionLimpia.proceso_institucional_actual || "",
      centerX: 149.5,
      y: 422,
      font,
      size: 5,
    });

    drawCenteredText({
      page,
      text: accionLimpia.nivel_gestion_actual || "",
      centerX: 149.5,
      y: 402,
      font,
      size: 5,
    });

    drawCenteredText({
      page,
      text: accionLimpia.unidad_organica || "",
      centerX: 149.5,
      y: 382,
      size: 5,
      font,
    });

    drawCenteredText({
      page,
      text: accionLimpia.denominacion_puesto || "",
      centerX: 149.5,
      y: 343,
      size: 5,
      font,
    });

    drawCenteredText({
      page,
      text: accionLimpia.escala_ocupacional || "",
      centerX: 149.5,
      y: 323,
      size: 5,
      font,
    });

    drawCenteredText({
      page,
      text: accionLimpia.lugar_trabajo || "",
      centerX: 149.5,
      y: 363,
      size: 5,
      font,
    });

    drawCenteredText({
      page,
      text: accionLimpia.grado ? accionLimpia.grado.toString() : "",
      centerX: 149.5,
      y: 303.3,
      size: 5,
      font,
    });

    drawCenteredText({
      page,
      text: accionLimpia.rmu_puesto ? `$${accionLimpia.rmu_puesto}` : "",
      centerX: 149.5,
      y: 283.5,
      size: 5,
      font,
    });

    drawCenteredText({
      page,
      text: `${accionLimpia.partida_individual || ""}${
        accionLimpia.modalidad_laboral
          ? ` (${accionLimpia.modalidad_laboral})`
          : ""
      }`,
      centerX: 149.5,
      y: 263,
      size: 5,
      font,
    });

    // Situación propuesta (solo si requiere_propuesta y existe)
    if (accion.requiere_propuesta && accionLimpia.unidad_organica_propuesta) {
      drawCenteredText({
        page,
        text: accionLimpia.proceso_institucional_propuesta || "",
        centerX: 410,
        y: 422,
        font,
        size: 5,
      });

      drawCenteredText({
        page,
        text: accionLimpia.nivel_gestion_propuesta || "",
        centerX: 410,
        y: 402,
        font,
        size: 5,
      });

      drawCenteredText({
        page,
        text: accionLimpia.unidad_organica_propuesta || "",
        centerX: 410,
        y: 382,
        font,
        size: 5,
      });

      drawCenteredText({
        page,
        text: accionLimpia.denominacion_puesto_propuesta || "",
        centerX: 410,
        y: 343,
        size: 5,
        font,
      });

      drawCenteredText({
        page,
        text: accionLimpia.escala_ocupacional_propuesta || "",
        centerX: 410,
        y: 323,
        size: 5,
        font,
      });

      drawCenteredText({
        page,
        text: accionLimpia.lugar_trabajo_propuesta || "",
        centerX: 410,
        y: 362,
        size: 5,
        font,
      });

      drawCenteredText({
        page,
        text: accionLimpia.grado_propuesta
          ? accionLimpia.grado_propuesta.toString()
          : "",
        centerX: 410,
        y: 303,
        size: 5,
        font,
      });

      drawCenteredText({
        page,
        text: accionLimpia.rmu_propuesta
          ? `$${accionLimpia.rmu_propuesta}`
          : "",
        centerX: 410,
        y: 283,
        size: 5,
        font,
      });

      drawCenteredText({
        page,
        text: `${accionLimpia.partida_propuesta || ""}${
          accionLimpia.modalidad_laboral_propuesta
            ? ` (${accionLimpia.modalidad_laboral_propuesta})`
            : ""
        }`,
        centerX: 410,
        y: 263,
        size: 5,
        font,
      });
    }

    // Declaración jurada
    page.drawText(accion.presento_declaracion_jurada ? "X" : "", {
      x: presentoDeclaracionJurada.true.x,
      y: presentoDeclaracionJurada.true.y,
      size: 6,
      font,
      color: rgb(0, 0, 0),
    });

    page.drawText(!accion.presento_declaracion_jurada ? "X" : "", {
      x: presentoDeclaracionJurada.false.x,
      y: presentoDeclaracionJurada.false.y,
      size: 6,
      font,
      color: rgb(0, 0, 0),
    });

    drawCenteredText({
      page,
      text: nombreFirmante || "",
      centerX: 435,
      y: 75,
      font,
      size: 6,
    });

    drawCenteredText({
      page,
      text: cargoFirmante || "",
      centerX: 435,
      y: 62,
      font,
      size: 6,
    });
    drawCenteredText({
      page,
      text: nombreFirmante2 || "",
      centerX: 170,
      y: 75,
      font,
      size: 6,
    });

    drawCenteredText({
      page,
      text: cargoFirmante2 || "",
      centerX: 170,
      y: 62,
      font,
      size: 6,
    });
    drawCenteredText({
      page: page2,
      text: nombreFirmante2 || "",
      centerX: 310,
      y: 488,
      font,
      size: 5,
    });

    drawCenteredText({
      page: page2,
      text: cargoFirmante2 || "",
      centerX: 310,
      y: 477,
      font,
      size: 5,
    });

    drawCenteredText({
      page: page2,
      text: nombreUsuario || "",
      centerX: 135,
      y: 488,
      font,
      size: 5,
    });

    drawCenteredText({
      page: page2,
      text: cargoUsuario || "",
      centerX: 135,
      y: 477,
      font,
      size: 5,
    });
    drawCenteredText({
      page: page2,
      text: nombreUsuario || "",
      centerX: 480,
      y: 488,
      font,
      size: 5,
    });

    drawCenteredText({
      page: page2,
      text: cargoUsuario || "",
      centerX: 480,
      y: 477,
      font,
      size: 5,
    });

    // exportar
    const pdfFinal = await pdfDoc.save();

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename=accion_personal_${accionLimpia.codigo_elaboracion}.pdf`,
    );

    res.send(Buffer.from(pdfFinal));
  } catch (error) {
    console.error("Error PDF:", error);
    res.status(500).json({ message: "Error generando PDF: " + error.message });
  }
};

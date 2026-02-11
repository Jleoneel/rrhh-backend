import path from "path";
import fs from "fs";
import { pool } from "../db.js";
import { PDFDocument, StandardFonts } from "pdf-lib";

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

    // ✅ POSTGRES QUERY (MODIFICADA PARA INCLUIR SITUACIÓN ACTUAL Y PROPUESTA)
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
        u.nombre AS unidad_organica,
        d.nombre AS denominacion_puesto,
        e.nombre AS escala_ocupacional,
        p.grado,
        p.rmu_puesto,
        p.partida_individual,

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
      WHERE ap.id = $1
      LIMIT 1;
      `,
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: "Acción no encontrada" });
    }

    const accion = result.rows[0];

    const { nombres, apellidos } = separarNombresApellidos(
      accion.nombres
    );

    // cargar plantilla
    const pdfPath = path.resolve("src/pdf/plantilla_accion_personal1.pdf");
    const pdfBytes = fs.readFileSync(pdfPath);

    const pdfDoc = await PDFDocument.load(pdfBytes);
    const page = pdfDoc.getPages()[0];
    const font = await pdfDoc.embedFont(StandardFonts.Helvetica);

    const tipoAccion = accion.tipo_accion;
    const drawCenteredText = ({
  page,
  text = "",
  centerX,
  y,
  font,
  size = 9,
}) => {
  const textWidth = font.widthOfTextAtSize(text, size);
  const x = centerX - textWidth / 2;

  page.drawText(text, {
    x,
    y,
    size,
    font,
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
      const words = text.split(" ");
      let line = "";
      let cursorY = y;

      for (let i = 0; i < words.length; i++) {
        const testLine = line + words[i] + " ";
        const width = font.widthOfTextAtSize(testLine, size);

        if (width > maxWidth && line !== "") {
          page.drawText(line, { x, y: cursorY, size, font });
          line = words[i] + " ";
          cursorY -= lineHeight;
        } else {
          line = testLine;
        }
      }

      if (line) {
        page.drawText(line, { x, y: cursorY, size, font });
      }
    };

    const tipos = {
      "Ingreso": { x: 132.3, y: 659.8 },
      "Reingreso": { x: 132.3, y: 650 },
      "Restitución": { x: 132.3, y: 641 },
      "Reintegro": { x: 132.3, y: 632 },
      "Ascenso": { x: 132.3, y: 622 },
      "Traslado": { x: 132.3, y: 612 },
      "Traspaso": { x: 262.8, y: 659.8 },
      "Cambio Administrativo": { x: 262.8, y: 650 },
      "Intercambio Voluntario": { x: 262.8, y: 641 },
      "Licencia": { x: 262.8, y: 632 },
      "Comisión de servicios": { x: 262.8, y: 622 },
      "Sanciones": { x: 262.8, y: 612 },
      "Incremento RMU": { x: 397.5, y: 659.8 },
      "Subrogación": { x: 397.5, y: 650 },
      "Encargo": { x: 397.5, y: 641 },
      "Cesación de Funciones": { x: 397.5, y: 632 },
      "Destitución": { x: 397.5, y: 622 },
      "Vacaciones": { x: 397.5, y: 612 },
      "Revisión Clasificación Puesto": { x: 522.3, y: 659.8 },
      "Otro": { x: 522.3, y: 650 },
    };

    const presentoDeclaracionJurada = {
      true: { x: 302, y: 590.4 },
      false: { x: 387.2, y: 590.4 },
    };

    if (tipos[tipoAccion]) {
      page.drawText("X", {
        x: tipos[tipoAccion].x,
        y: tipos[tipoAccion].y,
        size: 5,
        font,
      });
    }

    // escribir datos
    page.drawText(nombres || "", {
      x: 380,
      y: 738,
      size: 9,
      font,
    });

    page.drawText(apellidos || "", {
      x: 105,
      y: 738,
      size: 9,
      font,
    });

    page.drawText(accion.cedula, {
      x: 194,
      y: 693,
      size: 8,
      font,
    });
    page.drawText("CÉDULA", {
      x: 75,
      y: 693,
      size: 8,
      font,
    });

    page.drawText(
      new Date(accion.fecha_elaboracion).toLocaleDateString("es-EC", {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric'
      }).replace(/\//g, "-"),
      { x: 420, y: 755, size: 8, font }
    );
    page.drawText(
      new Date(accion.rige_desde).toLocaleDateString("es-EC", {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric'
      }).replace(/\//g, "-"),
      { x: 338, y: 693, size: 7, font }
    );
   if (accion.rige_hasta) {
  page.drawText(
    new Date(accion.rige_hasta)
      .toLocaleDateString("es-EC", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
      })
      .replace(/\//g, "-"),
    { x: 460, y: 693, size: 7, font }
  );
}


    drawWrappedText({
      page,
      text: accion.motivo || "",
      x: 40,          // inicio del recuadro
      y: 555,         // parte superior del recuadro
      maxWidth: 500,  // ancho del recuadro
      font,
      size: 9,
    });

    drawWrappedText({
      page,
      text: accion.otro_detalle || "",
      x: 419,          // inicio del recuadro
      y: 641,         // parte superior del recuadro
      maxWidth: 125,  // ancho del recuadro
      font,
      size: 7,
      lineHeight: 10,
    });

    page.drawText(accion.codigo_elaboracion || "", {
      x: 444,
      y: 781,
      size: 6,
      font,
    });

    //  situación actual 
      drawCenteredText({
  page,
  text:"SUSTANTIVO",
  centerX: 149.5,
  y: 422,
  font,
  size: 5,
});

drawCenteredText({
  page,
  text: "SEGUNDO NIVEL DE GESTIÓN",
  centerX: 149.5,
  y: 402,
  font,
  size: 5,
});
    drawCenteredText ( {page,
      text: accion.unidad_organica || "",
      centerX: 149.5,
      y: 382,  
      size: 5,
      font,
    });

    drawCenteredText( { page,
      text: accion.denominacion_puesto || "",
       centerX: 149.5,
      y: 343,  
      size: 5,
      font,
    });

    drawCenteredText( { page,
      text: accion.escala_ocupacional || "",
       centerX: 149.5,  
      y: 323,  
      size: 5,
      font,
    });

    drawCenteredText( { page,
      text: accion.lugar_trabajo || "",
       centerX: 149.5,  
      y: 363,  
      size: 5,
      font,
    });

    drawCenteredText( {page,
      text: accion.grado ? accion.grado.toString() : "",
      centerX: 149.5,
      y: 303.3,  
      size: 5,
      font,
    });

    drawCenteredText( {page,
      text: accion.rmu_puesto ? `$${accion.rmu_puesto}` : "",
      centerX: 149.5,
      y: 283.5,  
      size: 5,
      font,
    });

    drawCenteredText( {page,
      text: accion.partida_individual || "",
      centerX: 149.5,
      y: 263,  
      size: 5,
      font,
    });

    // Situación propuesta (solo si requiere_propuesta y existe)
    if (accion.requiere_propuesta && accion.unidad_organica_propuesta) {

  drawCenteredText({
  page,
  text: accion.proceso_institucional_propuesta || "",
  centerX: 410,
  y: 422,
  font,
  size: 5,
});

drawCenteredText({
  page,
  text: accion.nivel_gestion_propuesta || "",
  centerX: 410,
  y: 402,
  font,
  size: 5,
});
      
drawCenteredText({
  page,
  text: accion.unidad_organica_propuesta || "",
  centerX: 410,
  y: 382,
  font,
  size: 5,
});

      drawCenteredText( {page,
        text: accion.denominacion_puesto_propuesta || "",
        centerX: 410,
        x: 390,  
        y: 343,
        size: 5,
        font,
      });

      drawCenteredText({page,
        text: accion.escala_ocupacional_propuesta || "",
        centerX: 410,
        x: 365,  
        y: 323,
        size: 5,
        font,
      });

      drawCenteredText({
        page,
        text: accion.lugar_trabajo_propuesta || "",
        centerX: 410,
        y: 362,
        size: 5,
        font,
      });

      drawCenteredText( {page,
        text: accion.grado_propuesta ? accion.grado_propuesta.toString() : "",
        centerX: 410, 
        y: 303,
        size: 5,
        font,
      });

      drawCenteredText( {page,
        text: accion.rmu_propuesta ? `$${accion.rmu_propuesta}` : "",
        centerX: 410,
        y: 283,
        size: 5,
        font,
      });

      drawCenteredText( {page,
        text: accion.partida_propuesta || "",
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
    });

    page.drawText(!accion.presento_declaracion_jurada ? "X" : "", {
      x: presentoDeclaracionJurada.false.x,
      y: presentoDeclaracionJurada.false.y,
      size: 6,
      font,
    });

    // exportar
    const pdfFinal = await pdfDoc.save();

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename=accion_personal_${id}.pdf`
    );

    res.send(Buffer.from(pdfFinal));
  } catch (error) {
    console.error("Error PDF:", error);
    res.status(500).json({ message: "Error generando PDF" });
  }
};

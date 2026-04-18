import path from "path";
import fs from "fs";
import { pool } from "../../../../db.js";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

const limpiar = (texto = "") => {
  if (!texto) return "";
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
    .replace(/[ñ]/g, "n")
    .replace(/[Ñ]/g, "N")
    .replace(/\n/g, " ")
    .replace(/\s+/g, " ")
    .trim();
};

export const generarPdfVacacion = async (req, res) => {
  try {
    const { id } = req.params;

    const result = await pool.query(
      `
      SELECT
        vs.id, vs.tipo, vs.dias_solicitados, vs.estado,
        vs.telefono_domicilio, vs.telefono_movil,
        vs.observacion_jefe, vs.observacion_gerente,
        TO_CHAR(vs.fecha_solicitud, 'DD/MM/YYYY') AS fecha_solicitud,
        TO_CHAR(vs.fecha_inicio, 'DD-MM-YYYY') AS fecha_inicio,
        TO_CHAR(vs.fecha_fin, 'DD-MM-YYYY') AS fecha_fin,
        TO_CHAR(vs.fecha_respuesta_jefe, 'DD/MM/YYYY') AS fecha_resp_jefe,
        TO_CHAR(vs.fecha_respuesta_gerente, 'DD/MM/YYYY') AS fecha_resp_gerente,
        TO_CHAR(vs.fecha_respuesta_uath, 'DD/MM/YYYY') AS fecha_resp_uath,
        sv.nombres AS servidor_nombre,
        sv.numero_identificacion AS cedula,
        d.nombre AS denominacion_puesto,
        u.nombre AS unidad_organica,
        fj.nombre AS jefe_nombre,
        cj.nombre AS jefe_cargo,
        fg.nombre AS gerente_nombre,
        cg.nombre AS gerente_cargo,
        fu.nombre AS uath_nombre,
        cu.nombre AS uath_cargo,
        sp.horas_totales, sp.horas_usadas,
        (sp.horas_totales - sp.horas_usadas) AS horas_disponibles,
        uj.nombre AS unidad_jefe,
        ug.nombre AS unidad_gerente
      FROM core.vacacion_solicitud vs
      JOIN core.servidor sv ON sv.id = vs.servidor_id
      LEFT JOIN core.asignacion_puesto ap ON ap.servidor_id = sv.id AND ap.estado = 'ACTIVA'
      LEFT JOIN core.puesto p ON p.id = ap.puesto_id
      LEFT JOIN core.unidad_organica u ON u.id = p.unidad_organica_id
      LEFT JOIN core.denominacion_puesto d ON d.id = p.denominacion_puesto_id
      LEFT JOIN core.firmante fj ON fj.id = vs.jefe_firmante_id
      LEFT JOIN core.cargo cj ON cj.id = fj.cargo_id
      LEFT JOIN core.firmante fg ON fg.id = vs.gerente_id
      LEFT JOIN core.cargo cg ON cg.id = fg.cargo_id
      LEFT JOIN core.firmante fu ON fu.id = vs.uath_id
      LEFT JOIN core.cargo cu ON cu.id = fu.cargo_id
      LEFT JOIN core.saldo_permiso sp ON sp.servidor_id = sv.id
      LEFT JOIN core.unidad_organica uj ON uj.jefe_id = vs.jefe_firmante_id
      LEFT JOIN core.unidad_organica ug ON ug.jefe_superior_id = vs.gerente_id
      WHERE vs.id = $1 LIMIT 1
    `,
      [id],
    );

    if (!result.rows.length) {
      return res.status(404).json({ message: "Solicitud no encontrada" });
    }

    const v = result.rows[0];
    const aprobado = v.estado === "APROBADO";
    const negado = v.estado === "NEGADO";
    const diasTomados = (parseFloat(v.horas_usadas || 0) / 8).toFixed(1);
    const diasDisponibles = (parseFloat(v.horas_disponibles || 0) / 8).toFixed(
      1,
    );

    // Cargar plantilla
    const pdfPath = path.resolve(
      path.dirname(new URL(import.meta.url).pathname),
      "pdf/solicitud_vacaciones.pdf",
    );
    const pdfBytes = fs.readFileSync(pdfPath);
    const pdfDoc = await PDFDocument.load(pdfBytes);
    const page = pdfDoc.getPages()[0];

    // PDF es A4: 595.304 x 841.890
    // pdfplumber mide y desde ARRIBA, pdf-lib mide desde ABAJO
    // Conversión: pdf-lib y = 841.890 - pdfplumber_y1 + 1
    const H = 841.89;

    const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

    // Escribir texto
    const t = (text, x, y, size = 8, bold = false) => {
      const str = limpiar(String(text || ""));
      if (!str) return;
      page.drawText(str, {
        x,
        y,
        size,
        font: bold ? fontBold : font,
        color: rgb(0, 0, 0),
      });
    };

    // Tapar texto existente con rectángulo blanco
    const cover = (x, y_pdfplumber_top, w, h_pdfplumber) => {
      page.drawRectangle({
        x,
        y: H - y_pdfplumber_top - h_pdfplumber,
        width: w,
        height: h_pdfplumber + 2,
        color: rgb(1, 1, 1),
        borderWidth: 0,
      });
    };

    const sello = (x, y_top, aprobadoPor, cargo, fecha) => {
      const W = 130,
        Hb = 28;
      const yPdf = H - y_top;

      // Solo borde simple
      page.drawRectangle({
        x,
        y: yPdf - Hb,
        width: W,
        height: Hb,
        color: rgb(1, 1, 1),
        borderColor: rgb(0, 0, 0),
        borderWidth: 0.5,
      });

      // "APROBADO"
      const label = "APROBADO";
      const lw = fontBold.widthOfTextAtSize(label, 7);
      page.drawText(label, {
        x: x + (W - lw) / 2,
        y: yPdf - 10,
        size: 7,
        font: fontBold,
        color: rgb(0, 0, 0),
      });

      // Nombre
      const linea1 = `Yo, ${limpiar(aprobadoPor)}`;
      const l1w = font.widthOfTextAtSize(linea1, 5.5);
      page.drawText(linea1, {
        x: x + (W - l1w) / 2,
        y: yPdf - 18,
        size: 5.5,
        font,
        color: rgb(0, 0, 0),
      });

      // Fecha y cargo
      if (fecha) {
        page.drawText(fecha, {
          x: x + 3,
          y: yPdf - Hb + 3,
          size: 5,
          font,
          color: rgb(0.3, 0.3, 0.3),
        });
      }
      page.drawText(limpiar(cargo), {
        x: x + W - font.widthOfTextAtSize(limpiar(cargo), 5) - 3,
        y: yPdf - Hb + 3,
        size: 5,
        font,
        color: rgb(0.3, 0.3, 0.3),
      });
    };

    // ─── ENCABEZADO ──────────────────────────────────────────────
    // "ORDEN DE TRAMITE No." → label bottom y1=81.0
    t(`VAC-${String(v.id).padStart(4, "0")}-2026`, 232, H - 81.0 + 1, 8);

    // "Lugar y Fecha:" → label bottom y1=102.5
    t(`PORTOVIEJO, ${v.fecha_solicitud}`, 206, H - 101 + 1, 8);

    // ─── DATOS DEL SOLICITANTE ────────────────────────────────────
    // "Nombre de la Unidad a la que pertenece:" → y1=140.7
    t(v.unidad_organica || "", 168, H - 139 + 1, 7);

    // Nombre servidor → espacio en blanco entre y1=163.1 y y0=180.9
    t(v.servidor_nombre || "", 218, H - 161, 8);

    // Cédula → después de "Cédula:" y1=187.4
    t(v.cedula || "", 93, H - 186 + 1, 8);

    // Cargo → después de "Cargo:" y1=187.4, x=220.9
    t(limpiar(v.denominacion_puesto || ""), 224, H - 186 + 1, 7);

    // ─── SOLICITUD DE DÍAS ────────────────────────────────────────
    // Cubrir placeholder "X" (dias) en x0=100.6, y0=217.5, y1=224.0
    cover(99, 217.5, 10, 6.5);
    t(String(v.dias_solicitados), 102, H - 222.5 + 1, 8);

    // Cubrir "X-X-XHASTA EL X-X-X" desde x=227.4 hasta x=295
    cover(245, 217, 72, 6.5);
    t(`${v.fecha_inicio} HASTA EL ${v.fecha_fin}`, 248, H - 222.5 + 1, 8);

    // ─── TIPO DE SOLICITUD ────────────────────────────────────────
    if (v.tipo === "VACACION_PROGRAMADA") {
      t("X", 166, H - 263, 8, true);
    } else {
      t("X", 166, H - 283, 8, true);
    }

    // ─── TELÉFONOS ────────────────────────────────────────────────
    // Caja de teléfono: x0=442.149, y=323.253
    const tel = [v.telefono_movil].filter(Boolean).join(" / ");
    t(tel, 450, H - 332, 7);

    // ─── AUTORIZACIÓN ─────────────────────────────────────────────
    // Checkbox AUTORIZADO: x0=102.555, y=393.674
    // Checkbox NEGADO: x0=210.379, y=397.561
    if (aprobado) t("X", 108, H - 403, 9, true);
    if (negado) t("X", 216, H - 407, 9, true);

    // Observación de negación — línea en blanco después de "explique:"
    const obs = limpiar(v.observacion_jefe || v.observacion_gerente || "");
    if (obs) {
      t(obs.substring(0, 50), 335, H - 384.2 + 1, 7);
      if (obs.length > 50) t(obs.substring(50, 100), 301, H - 399.7 + 1, 7);
      if (obs.length > 100) t(obs.substring(100, 150), 301, H - 415.2 + 1, 7);
    }

    // ─── FIRMAS DE APROBACIÓN ─────────────────────────────────────
    const unidadJefe = limpiar(v.unidad_jefe || "");
    cover(120, 473.6, 42, 7.1);
    if (unidadJefe.length > 35) {
      t(unidadJefe.substring(0, 35), 79, H - 480 + 1, 7);
      t(unidadJefe.substring(35), 79, H - 487 + 1, 7);
    } else {
      t(unidadJefe, 30, H - 479 + 1, 5.5);
    }

    t(limpiar(v.jefe_nombre || ""), 93, H - 496 + 1, 7);
    cover(49.5, 503.8, 42, 7.1);
    t(limpiar(v.jefe_cargo || "JEFE DE AREA"), 50, H - 510 + 1, 7);
    if (v.jefe_nombre && v.fecha_resp_jefe) {
      sello(
        52,
        515,
        v.jefe_nombre,
        v.jefe_cargo || "JEFE DE AREA",
        v.fecha_resp_jefe,
      );
    }

    // Gerente - cubrir "esto cambia" y poner unidad real
    cover(253, 473.6, 120, 7.1);
    t(limpiar(v.gerente_cargo || ""), 254, H - 480.7 + 1, 5.5);

    t(limpiar(v.gerente_nombre || ""), 317, H - 496.1 + 1, 7);
    cover(273.5, 503.8, 42, 7.1);
    t(limpiar(v.gerente_cargo || "GERENTE"), 275, H - 510.9 + 1, 7);
    if (v.gerente_nombre && v.fecha_resp_gerente) {
      sello(
        317,
        515,
        v.gerente_nombre,
        v.gerente_cargo || "GERENTE",
        v.fecha_resp_gerente,
      );
    }

    // ─── UATH ─────────────────────────────────────────────────────
    // Caja días tomados: x0=123.725, y=566.557
    t(v.dias_solicitados, 126, H - 576, 7);

    // Caja días disponibles: x0=350.005, y=568.437
    t(diasDisponibles, 353, H - 576, 7);

    // ─── REVISADO POR ─────────────────────────────────────────────
    cover(0, 664.0, 118, 6);
    t(limpiar(v.uath_nombre || ""), 213, H - 669.9 + 1, 7, true);

    // ← Agregar cargo debajo del nombre
    cover(0, 674.8, 152, 6);
    t(
      limpiar(v.uath_cargo || "RESPONSABLE DE LA UNIDAD DE TALENTO HUMANO"),
      185,
      H - 680.7 + 1,
      6,
    );

    if (v.fecha_resp_uath) t(v.fecha_resp_uath, 40, H - 650, 6);

    // Exportar
    const pdfFinal = await pdfDoc.save();
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename=vacacion_${id}.pdf`,
    );
    res.send(Buffer.from(pdfFinal));
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Error generando PDF: " + error.message });
  }
};

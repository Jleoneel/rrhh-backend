import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { pdflibAddPlaceholder } from "@signpdf/placeholder-pdf-lib";
import pkg from "@signpdf/signpdf";
import signerPkg from "@signpdf/signer-p12";
import fs from "fs";
import moment from "moment-timezone";
import QRCode from "qrcode";

const { default: signpdf } = pkg;
const { P12Signer } = signerPkg;

const generarQRBuffer = async (texto) => {
  const qrDataUrl = await QRCode.toDataURL(texto, {
    width: 60,
    margin: 1,
    color: { dark: "#000000", light: "#ffffff" },
  });
  const base64 = qrDataUrl.replace("data:image/png;base64,", "");
  return Buffer.from(base64, "base64");
};

const POSICIONES = {
  jefe: { x: 60, y: 300, width: 160, height: 28 },
  superior: { x: 310, y: 300, width: 180, height: 28 },
  uath: { x: 160, y: 185, width: 180, height: 28 },
};

const POSICIONES_ACCION = {
  elabora: { x: 70, y: 500, width: 115, height: 40, page: 1 },
  registra_controla: { x: 415, y: 500, width: 115, height: 40, page: 1 },
  revisa: { x: 235, y: 500, width: 115, height: 40, page: 1 },
  aprueba_th: { x: 90, y: 85, width: 115, height: 40, page: 0 },
  aprueba_autoridad: { x: 350, y: 85, width: 115, height: 40, page: 0 },
};

// Recuadro "FIRMA DEL RESPONSABLE QUE NOTIFICÓ" en la página 2 (índice 1)
// de la plantilla de Acciones de Personal. Solo se usa cuando quien
// firma como "aprueba_th" (RESPONSABLE DE LA UATH) ya generó su QR para
// la página 1: ese MISMO qrImage se dibuja también aquí, sin generar un
// segundo QR ni una segunda firma. Coordenadas verificadas contra el
// texto real de la plantilla (pdftotext -bbox-layout): el título "FIRMA
// DEL RESPONSABLE QUE NOTIFICÓ" y su línea quedan justo debajo (y<131),
// y "NOMBRE:"/"PUESTO:" quedan muy por debajo (y<103). La franja
// y=136..172 está completamente en blanco en la plantilla, verificado
// también renderizando una superposición de prueba.
const POSICION_QR_NOTIFICACION_UATH = {
  x: 269,
  y: 136,
  width: 36,
  height: 36,
  page: 1,
};

const limpiarTexto = (texto = "") => {
  const replacements = {
    á: "a", à: "a", ä: "a", â: "a",
    é: "e", è: "e", ë: "e", ê: "e",
    í: "i", ì: "i", ï: "i", î: "i",
    ó: "o", ò: "o", ö: "o", ô: "o",
    ú: "u", ù: "u", ü: "u", û: "u",
    ñ: "n", Ñ: "N",
    Á: "A", À: "A", Ä: "A", Â: "A",
    É: "E", È: "E", Ë: "E", Ê: "E",
    Í: "I", Ì: "I", Ï: "I", Î: "I",
    Ó: "O", Ò: "O", Ö: "O", Ô: "O",
    Ú: "U", Ù: "U", Ü: "U", Û: "U",
  };
  return texto.replace(/[áàäâéèëêíìïîóòöôúùüûñÑÁÀÄÂÉÈËÊÍÌÏÎÓÒÖÔÚÙÜÛ]/g, (match) => replacements[match] || match).trim();
};

const getFechaHoraEcuador = () => {
  return moment().tz("America/Guayaquil");
};

// FIRMA SIMPLIFICADA PARA VACACIONES
export const firmarPdfConP12 = async ({
  pdfInputBuffer,
  p12Path,
  p12Password,
  firmante,
  cargo,
  posicion = "jefe",
}) => {
  try {
    const pdfDoc = await PDFDocument.load(pdfInputBuffer, {
      ignoreEncryption: true,
    });
    const page = pdfDoc.getPages()[0];

    const pos = POSICIONES[posicion];
    if (!pos) throw new Error(`Posicion invalida: ${posicion}`);

    const fontRegular = await pdfDoc.embedFont(StandardFonts.Helvetica);

    const nombreLimpio = limpiarTexto(firmante);
    const fechaHora = getFechaHoraEcuador();
    const fechaFormateada = fechaHora.format("DD/MM/YYYY");

    // Generar QR con metadatos
    const qrTexto = `Firmado por: ${firmante}\nFecha: ${fechaFormateada}`;
    const qrBuffer = await generarQRBuffer(qrTexto);
    const qrImage = await pdfDoc.embedPng(qrBuffer);

    const qrSize = pos.height - 4;
    const qrX = pos.x + 2;
    const qrY = pos.y + 2;

    const textX = qrX + qrSize + 4;
    const textWidth = pos.width - qrSize - 8;

    // QR
    page.drawImage(qrImage, {
      x: qrX, y: qrY,
      width: qrSize, height: qrSize,
    });

    // Nombre del firmante
    page.drawText(nombreLimpio, {
      x: textX + 2,
      y: pos.y + pos.height - 12,
      size: 5,
      font: fontRegular,
      color: rgb(0, 0, 0),
    });

    // Fecha
    page.drawText(fechaFormateada, {
      x: textX + 2,
      y: pos.y + 4,
      size: 4.5,
      font: fontRegular,
      color: rgb(0, 0, 0),
    });

    // Placeholder para firma digital
    await pdflibAddPlaceholder({
      pdfDoc,
      reason: `Aprobacion de vacaciones - ${cargo}`,
      contactInfo: "talento.humano@hpvc.gob.ec",
      name: firmante || "Desconocido",
      location: "Portoviejo, Manabi, Ecuador",
      signatureLength: 16000,
      widgetRect: [pos.x, pos.y, pos.x + pos.width, pos.y + pos.height],
      pageNumber: 0,
    });

    const pdfWithPlaceholderBuffer = Buffer.from(
      await pdfDoc.save({ addDefaultPage: false }),
    );

    const p12Buffer = fs.readFileSync(p12Path);
    const signer = new P12Signer(p12Buffer, { passphrase: p12Password });
    const signedPdf = await signpdf.sign(pdfWithPlaceholderBuffer, signer);

    return signedPdf;
  } catch (error) {
    console.error(`[SIGN] Error critico:`, error.message);
    throw new Error(`Error en firma digital: ${error.message}`);
  }
};

// FIRMA SIMPLIFICADA PARA ACCIONES DE PERSONAL
export const firmarPdfAccionConP12 = async ({
  pdfInputBuffer,
  p12Path,
  p12Password,
  firmante,
  cargo,
  posicion,
}) => {
  try {
    const pdfDoc = await PDFDocument.load(pdfInputBuffer, {
      ignoreEncryption: true,
    });

    const pos = POSICIONES_ACCION[posicion];
    if (!pos) throw new Error(`Posición inválida: ${posicion}`);

    const pages = pdfDoc.getPages();
    const page = pages[pos.page];
    if (!page) throw new Error(`Página ${pos.page} no existe en el PDF`);

    const fontRegular = await pdfDoc.embedFont(StandardFonts.Helvetica);

    const nombreLimpio = limpiarTexto(firmante || "");
    const fechaHora = moment().tz("America/Guayaquil");
    const fechaFormateada = fechaHora.format("DD/MM/YYYY");

    // Generar QR con metadatos
    const qrTexto = `Firmado por: ${firmante}\nFecha: ${fechaFormateada}`;
    const qrBuffer = await generarQRBuffer(qrTexto);
    const qrImage = await pdfDoc.embedPng(qrBuffer);

    const qrSize = pos.height - 4;
    const qrX = pos.x + 2;
    const qrY = pos.y + 2;

    const textX = qrX + qrSize + 4;
    const textWidth = pos.width - qrSize - 8;

    // QR
    page.drawImage(qrImage, {
      x: qrX, y: qrY,
      width: qrSize, height: qrSize,
    });

    // Nombre del firmante
    page.drawText(nombreLimpio, {
      x: textX + 2,
      y: pos.y + pos.height - 12,
      size: 5,
      font: fontRegular,
      color: rgb(0, 0, 0),
    });

    // Fecha
    page.drawText(fechaFormateada, {
      x: textX + 2,
      y: pos.y + 4,
      size: 4.5,
      font: fontRegular,
      color: rgb(0, 0, 0),
    });

    // Reutilizar el MISMO QR (misma firma, no una segunda) en el
    // recuadro "FIRMA DEL RESPONSABLE QUE NOTIFICÓ" de la página 2,
    // únicamente cuando quien firma es RESPONSABLE DE LA UATH
    // (rol_firma "aprueba_th"). Se dibuja el mismo objeto qrImage ya
    // embebido arriba — no se genera un segundo QR ni un segundo
    // placeholder de firma — y siempre antes del sellado criptográfico
    // final, para que quede incluido en la misma revisión firmada.
    if (posicion === "aprueba_th") {
      const notifPos = POSICION_QR_NOTIFICACION_UATH;
      const paginaNotificacion = pages[notifPos.page];
      if (paginaNotificacion) {
        paginaNotificacion.drawImage(qrImage, {
          x: notifPos.x,
          y: notifPos.y,
          width: notifPos.width,
          height: notifPos.height,
        });
      }
    }

    // Placeholder firma digital
    await pdflibAddPlaceholder({
      pdfDoc,
      reason: `${posicion} - Accion de Personal`,
      contactInfo: "talento.humano@hpvc.gob.ec",
      name: firmante || "Desconocido",
      location: "Portoviejo, Manabi, Ecuador",
      signatureLength: 32768,
      widgetRect: [pos.x, pos.y, pos.x + pos.width, pos.y + pos.height],
      pageNumber: pos.page,
    });

    const pdfBuffer = Buffer.from(await pdfDoc.save({ addDefaultPage: false }));
    const p12Buffer = fs.readFileSync(p12Path);
    const signer = new P12Signer(p12Buffer, { passphrase: p12Password });
    const signedPdf = await signpdf.sign(pdfBuffer, signer);

    console.log(`[SIGN ACCION] ${posicion} firmado: ${signedPdf.length} bytes`);
    return signedPdf;
  } catch (error) {
    console.error(`[SIGN ACCION] Error:`, error.message);
    throw new Error(`Error firmando acción: ${error.message}`);
  }
};

// MARCADO DE APROBADO (sin cambios)
export const marcarAprobadoEnPdf = async (pdfInputBuffer) => {
  const pdfDoc = await PDFDocument.load(pdfInputBuffer, {
    ignoreEncryption: true,
  });
  const page = pdfDoc.getPages()[0];
  const H = 841.89;
  const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  page.drawText("X", {
    x: 108,
    y: H - 403,
    size: 9,
    font: fontBold,
    color: rgb(0, 0, 0),
  });

  return Buffer.from(await pdfDoc.save({ addDefaultPage: false }));
};

export const POSICIONES_FIRMA = POSICIONES;
export const POSICIONES_ACCION_FIRMA = POSICIONES_ACCION;
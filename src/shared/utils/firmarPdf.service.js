import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { pdflibAddPlaceholder } from "@signpdf/placeholder-pdf-lib";
import pkg from "@signpdf/signpdf";
import signerPkg from "@signpdf/signer-p12";
import fs from "fs";
import moment from "moment-timezone";

const { default: signpdf } = pkg;
const { P12Signer } = signerPkg;

const POSICIONES = {
  jefe: { x: 60, y: 300, width: 160, height: 28 },
  superior: { x: 310, y: 300, width: 180, height: 28 },
  uath: { x: 160, y: 185, width: 180, height: 28 },
};

const POSICIONES_ACCION = {
  elabora: { x: 42, y: 474, width: 160, height: 50, page: 1 },
  registra_controla: { x: 386, y: 472, width: 155, height: 50, page: 1 },
  revisa: { x: 209, y: 472, width: 160, height: 50, page: 1 },
  aprueba_th: { x: 42, y: 58, width: 240, height: 50, page: 0 },
  aprueba_autoridad: { x: 303, y: 58, width: 250, height: 50, page: 0 },
};

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
    const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

    const nombreLimpio = limpiarTexto(firmante || "");
    const cargoLimpio = limpiarTexto(cargo || "");
    const fechaHora = moment().tz("America/Guayaquil");
    const fechaFormateada = fechaHora.format("DD/MM/YYYY");
    const horaFormateada = fechaHora.format("HH:mm:ss");

    // Recuadro
    page.drawRectangle({
      x: pos.x,
      y: pos.y,
      width: pos.width,
      height: pos.height,
      borderColor: rgb(0, 0.3, 0.6),
      borderWidth: 1,
      color: rgb(0.97, 0.98, 1),
    });

    // Banda superior
    page.drawRectangle({
      x: pos.x,
      y: pos.y + pos.height - 10,
      width: pos.width,
      height: 10,
      color: rgb(0, 0.3, 0.6),
      borderWidth: 0,
    });

    // FIRMADO DIGITALMENTE
    const label = "FIRMADO DIGITALMENTE";
    const lw = fontBold.widthOfTextAtSize(label, 5.5);
    page.drawText(label, {
      x: pos.x + (pos.width - lw) / 2,
      y: pos.y + pos.height - 8,
      size: 5.5,
      font: fontBold,
      color: rgb(1, 1, 1),
    });

    // Certificadora
    const cert = "BCE Ecuador - Security Data S.A.";
    const certw = fontRegular.widthOfTextAtSize(cert, 5);
    page.drawText(cert, {
      x: pos.x + (pos.width - certw) / 2,
      y: pos.y + 12,
      size: 5,
      font: fontRegular,
      color: rgb(0, 0.3, 0.6),
    });

    // Fecha y hora
    const fechaHoraStr = `${fechaFormateada}  ${horaFormateada}`;
    const fw = fontRegular.widthOfTextAtSize(fechaHoraStr, 5);
    page.drawText(fechaHoraStr, {
      x: pos.x + (pos.width - fw) / 2,
      y: pos.y + 4,
      size: 5,
      font: fontRegular,
      color: rgb(0.3, 0.3, 0.3),
    });

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

const limpiarTexto = (texto = "") => {
  const replacements = {
    á: "a",
    à: "a",
    ä: "a",
    â: "a",
    é: "e",
    è: "e",
    ë: "e",
    ê: "e",
    í: "i",
    ì: "i",
    ï: "i",
    î: "i",
    ó: "o",
    ò: "o",
    ö: "o",
    ô: "o",
    ú: "u",
    ù: "u",
    ü: "u",
    û: "u",
    ñ: "n",
    Ñ: "N",
    Á: "A",
    À: "A",
    Ä: "A",
    Â: "A",
    É: "E",
    È: "E",
    Ë: "E",
    Ê: "E",
    Í: "I",
    Ì: "I",
    Ï: "I",
    Î: "I",
    Ó: "O",
    Ò: "O",
    Ö: "O",
    Ô: "O",
    Ú: "U",
    Ù: "U",
    Ü: "U",
    Û: "U",
  };
  return texto
    .replace(
      /[áàäâéèëêíìïîóòöôúùüûñÑÁÀÄÂÉÈËÊÍÌÏÎÓÒÖÔÚÙÜÛ]/g,
      (match) => replacements[match] || match,
    )
    .trim();
};

const getFechaHoraEcuador = () => {
  return moment().tz("America/Guayaquil");
};

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
    const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
    const fontItalic = await pdfDoc.embedFont(StandardFonts.HelveticaOblique);

    const nombreLimpio = limpiarTexto(firmante);
    const cargoLimpio = limpiarTexto(cargo);
    const fechaHora = getFechaHoraEcuador();
    const fechaFormateada = fechaHora.format("DD/MM/YYYY");
    const horaFormateada = fechaHora.format("HH:mm:ss");

    // Recuadro
    page.drawRectangle({
      x: pos.x,
      y: pos.y,
      width: pos.width,
      height: pos.height,
      borderColor: rgb(0, 0.3, 0.6),
      borderWidth: 1,
      color: rgb(0.97, 0.98, 1),
    });

    // Banda superior
    page.drawRectangle({
      x: pos.x,
      y: pos.y + pos.height - 10,
      width: pos.width,
      height: 10,
      color: rgb(0, 0.3, 0.6),
      borderWidth: 0,
    });

    // FIRMADO DIGITALMENTE
    const label = "FIRMADO DIGITALMENTE";
    const lw = fontBold.widthOfTextAtSize(label, 5.5);
    page.drawText(label, {
      x: pos.x + (pos.width - lw) / 2,
      y: pos.y + pos.height - 8,
      size: 5.5,
      font: fontBold,
      color: rgb(1, 1, 1),
    });

    // Certificadora
    const cert = "BCE Ecuador - Security Data S.A.";
    const certw = fontRegular.widthOfTextAtSize(cert, 5);
    page.drawText(cert, {
      x: pos.x + (pos.width - certw) / 2,
      y: pos.y + 12,
      size: 5,
      font: fontRegular,
      color: rgb(0, 0.3, 0.6),
    });

    // Fecha y hora
    const fechaHoraStr = `${fechaFormateada}  ${horaFormateada}`;
    const fw = fontRegular.widthOfTextAtSize(fechaHoraStr, 5);
    page.drawText(fechaHoraStr, {
      x: pos.x + (pos.width - fw) / 2,
      y: pos.y + 4,
      size: 5,
      font: fontRegular,
      color: rgb(0.3, 0.3, 0.3),
    });

    // 14. Placeholder para firma digital
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

// Agregar esta función exportada
export const marcarAprobadoEnPdf = async (pdfInputBuffer) => {
  const pdfDoc = await PDFDocument.load(pdfInputBuffer, {
    ignoreEncryption: true,
  });
  const page = pdfDoc.getPages()[0];
  const H = 841.89;
  const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  // Marcar X en AUTORIZADO
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

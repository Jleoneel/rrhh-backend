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

    console.log(
      `[SIGN] PDF preparado: ${pdfWithPlaceholderBuffer.length} bytes`,
    );

    const p12Buffer = fs.readFileSync(p12Path);
    console.log(`[SIGN] Certificado cargado: ${p12Buffer.length} bytes`);

    const signer = new P12Signer(p12Buffer, { passphrase: p12Password });

    console.log(`[SIGN] Aplicando firma digital...`);
    const signedPdf = await signpdf.sign(pdfWithPlaceholderBuffer, signer);

    console.log(`[SIGN] Documento firmado! Tamaño: ${signedPdf.length} bytes`);
    return signedPdf;
  } catch (error) {
    console.error(`[SIGN] Error critico:`, error.message);
    throw new Error(`Error en firma digital: ${error.message}`);
  }
};

export const POSICIONES_FIRMA = POSICIONES;

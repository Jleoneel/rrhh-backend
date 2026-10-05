// @cantoo/pdf-lib (NO "pdf-lib") — es un fork que sí soporta actualizaciones
// incrementales. Es imprescindible para firmar un PDF que ya tiene una firma
// previa: "pdf-lib" normal reescribe el archivo completo en cada .save(), lo
// que corre de lugar los bytes que una firma anterior ya selló en su
// /ByteRange y la invalida en silencio — confirmado con pdfsig: de 5 firmas
// en cadena, solo la última quedaba "Signature is Valid", las 4 previas
// mostraban "Digest Mismatch". Ver agregarPlaceholderFirma() más abajo.
import {
  PDFDocument,
  StandardFonts,
  rgb,
  PDFArray,
  PDFName,
  PDFHexString,
  PDFString,
  PDFInvalidObject,
  PDFNumber,
  PDFDict,
} from "@cantoo/pdf-lib";
import {
  DEFAULT_BYTE_RANGE_PLACEHOLDER,
  SUBFILTER_ADOBE_PKCS7_DETACHED,
  ANNOTATION_FLAGS,
  SIG_FLAGS,
} from "@signpdf/utils";
import pkg from "@signpdf/signpdf";
import signerPkg from "@signpdf/signer-p12";
import fs from "fs";
import moment from "moment-timezone";
import QRCode from "qrcode";

const { default: signpdf } = pkg;
const { P12Signer } = signerPkg;

// Reimplementación de @signpdf/placeholder-pdf-lib usando EXCLUSIVAMENTE las
// clases de @cantoo/pdf-lib. El paquete @signpdf/placeholder-pdf-lib importa
// "pdf-lib" (el real) internamente y construye los objetos del placeholder
// con SUS clases — al registrarlos dentro de un context de @cantoo/pdf-lib
// (un fork distinto, con sus propias clases PDFName/PDFArray/etc.), el
// writer de @cantoo/pdf-lib no los reconoce como propios y el placeholder
// no queda serializado: signpdf.sign() falla con "No ByteRangeStrings found
// within PDF buffer" (confirmado probándolo). La única forma segura de
// mezclar ambos paquetes es no mezclarlos: construir el mismo diccionario de
// firma a mano, con las clases de @cantoo/pdf-lib.
function agregarPlaceholderFirma({
  pdfDoc,
  reason,
  contactInfo,
  name,
  location,
  signatureLength,
  widgetRect,
  pageNumber = 0,
}) {
  const doc = pdfDoc;
  const page = doc.getPages()[pageNumber];

  const byteRange = PDFArray.withContext(doc.context);
  byteRange.push(PDFNumber.of(0));
  byteRange.push(PDFName.of(DEFAULT_BYTE_RANGE_PLACEHOLDER));
  byteRange.push(PDFName.of(DEFAULT_BYTE_RANGE_PLACEHOLDER));
  byteRange.push(PDFName.of(DEFAULT_BYTE_RANGE_PLACEHOLDER));

  const placeholder = PDFHexString.of(
    String.fromCharCode(0).repeat(signatureLength),
  );

  const signatureDict = doc.context.obj({
    Type: "Sig",
    Filter: "Adobe.PPKLite",
    SubFilter: SUBFILTER_ADOBE_PKCS7_DETACHED,
    ByteRange: byteRange,
    Contents: placeholder,
    Reason: PDFString.of(reason),
    M: PDFString.fromDate(new Date()),
    ContactInfo: PDFString.of(contactInfo),
    Name: PDFString.of(name),
    Location: PDFString.of(location),
    Prop_Build: { Filter: { Name: "Adobe.PPKLite" } },
  });

  const signatureBuffer = new Uint8Array(signatureDict.sizeInBytes());
  signatureDict.copyBytesInto(signatureBuffer, 0);
  const signatureObj = PDFInvalidObject.of(signatureBuffer);
  const signatureDictRef = doc.context.register(signatureObj);

  const rect = PDFArray.withContext(doc.context);
  widgetRect.forEach((c) => rect.push(PDFNumber.of(c)));
  const apStream = doc.context.formXObject([], {
    BBox: widgetRect,
    Resources: {},
  });

  const widgetDict = doc.context.obj({
    Type: "Annot",
    Subtype: "Widget",
    FT: "Sig",
    Rect: rect,
    V: signatureDictRef,
    T: PDFString.of("Signature1"),
    F: ANNOTATION_FLAGS.PRINT,
    P: page.ref,
    AP: { N: doc.context.register(apStream) },
  });

  const widgetDictRef = doc.context.register(widgetDict);

  let annotations = page.node.lookupMaybe(PDFName.of("Annots"), PDFArray);
  if (typeof annotations === "undefined") {
    annotations = doc.context.obj([]);
  }
  annotations.push(widgetDictRef);
  page.node.set(PDFName.of("Annots"), annotations);

  let acroForm = doc.catalog.lookupMaybe(PDFName.of("AcroForm"), PDFDict);
  if (typeof acroForm === "undefined") {
    acroForm = doc.context.obj({ Fields: [] });
    const acroFormRef = doc.context.register(acroForm);
    doc.catalog.set(PDFName.of("AcroForm"), acroFormRef);
  }

  let sigFlags;
  if (acroForm.has(PDFName.of("SigFlags"))) {
    sigFlags = acroForm.get(PDFName.of("SigFlags"));
  } else {
    sigFlags = PDFNumber.of(0);
  }
  const updatedFlags = PDFNumber.of(
    sigFlags.asNumber() | SIG_FLAGS.SIGNATURES_EXIST | SIG_FLAGS.APPEND_ONLY,
  );
  acroForm.set(PDFName.of("SigFlags"), updatedFlags);

  let fields = acroForm.get(PDFName.of("Fields"));
  if (!(fields instanceof PDFArray)) {
    fields = doc.context.obj([]);
    acroForm.set(PDFName.of("Fields"), fields);
  }
  fields.push(widgetDictRef);
}

const generarQRBuffer = async (texto) => {
  const qrDataUrl = await QRCode.toDataURL(texto, {
    width: 60,
    margin: 1,
    color: { dark: "#000000", light: "#ffffff" },
  });
  const base64 = qrDataUrl.replace("data:image/png;base64,", "");
  return Buffer.from(base64, "base64");
};

// Coordenadas verificadas con pdftotext -bbox sobre la plantilla: la
// linea "f). ______" (firma del solicitante, seccion DATOS DEL
// SOLICITANTE) esta en x=216.3..334.8, y=305.2..314.7 (origen arriba-
// izquierda). Convertido a coordenadas pdf-lib (origen abajo-izquierda,
// H=841.89): el recuadro queda justo sobre esa linea.
const POSICIONES = {
  solicitante: { x: 226, y: 527, width: 190, height: 24 },
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
  // Recuadro "ACEPTACIÓN Y/O RECEPCIÓN DEL SERVIDOR PÚBLICO", página 2
  // (índice 1), columna izquierda (la derecha es para el testigo, no se
  // usa aquí). Coordenadas verificadas por escaneo de píxeles sobre la
  // plantilla renderizada: borde superior de la caja en pdflib y≈762.6,
  // línea "FIRMA" en y≈682.0, borde izquierdo x≈25.7, divisor con la
  // columna del testigo en x≈286.7 — y confirmadas con una superposición
  // de prueba antes de aplicar el valor real.
  recibido: { x: 75, y: 685, width: 200, height: 50, page: 1 },
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

// Margen de seguridad (bytes) sobre el tamaño de firma medido, para
// absorber la pequeña variación entre firmas del mismo .p12 (la fecha de
// firma va en un atributo autenticado de longitud fija, así que la
// variación real es mínima, pero se deja margen por robustez).
const MARGEN_SEGURIDAD_FIRMA = 2048;

// El tamaño real de la estructura PKCS#7 depende únicamente del
// certificado .p12 (cuántos certificados trae la cadena, tamaño de la
// llave) — NO del contenido del PDF firmado (verificado empíricamente:
// firmar un buffer de 16 bytes o uno de 50KB con el mismo .p12 produce
// exactamente el mismo número de bytes de firma). Por eso se puede medir
// el tamaño real firmando un buffer mínimo de prueba con el mismo .p12,
// antes de reservar el placeholder — en vez de adivinar un número fijo
// que un certificado con una cadena más larga puede volver a superar
// (como pasó: un placeholder de 16000 no alcanzó para una firma de
// 16937 bytes reales).
const calcularSignatureLength = async (p12Buffer, p12Password) => {
  const signerDePrueba = new P12Signer(p12Buffer, {
    passphrase: p12Password,
  });
  const rawDePrueba = await signerDePrueba.sign(Buffer.from("medicion"));
  return (rawDePrueba.length + MARGEN_SEGURIDAD_FIRMA) * 2;
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
      forIncrementalUpdate: true,
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

    const p12Buffer = fs.readFileSync(p12Path);
    const signatureLength = await calcularSignatureLength(
      p12Buffer,
      p12Password,
    );

    // Placeholder para firma digital
    agregarPlaceholderFirma({
      pdfDoc,
      reason: `Aprobacion de vacaciones - ${cargo}`,
      contactInfo: "talento.humano@hpvc.gob.ec",
      name: firmante || "Desconocido",
      location: "Portoviejo, Manabi, Ecuador",
      signatureLength,
      widgetRect: [pos.x, pos.y, pos.x + pos.width, pos.y + pos.height],
      pageNumber: 0,
    });

    const pdfWithPlaceholderBuffer = Buffer.from(
      await pdfDoc.save({ addDefaultPage: false }),
    );
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
      forIncrementalUpdate: true,
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

    const p12Buffer = fs.readFileSync(p12Path);
    const signatureLength = await calcularSignatureLength(
      p12Buffer,
      p12Password,
    );

    // Placeholder firma digital
    agregarPlaceholderFirma({
      pdfDoc,
      reason: `${posicion} - Accion de Personal`,
      contactInfo: "talento.humano@hpvc.gob.ec",
      name: firmante || "Desconocido",
      location: "Portoviejo, Manabi, Ecuador",
      signatureLength,
      widgetRect: [pos.x, pos.y, pos.x + pos.width, pos.y + pos.height],
      pageNumber: pos.page,
    });

    const pdfBuffer = Buffer.from(await pdfDoc.save({ addDefaultPage: false }));
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
// Puede recibir un PDF que YA tiene una o más firmas previas (jefe/gerente)
// cuando UATH certifica — misma razón para forIncrementalUpdate que en las
// funciones de arriba: dibujar el check "AUTORIZADO" no debe invalidar lo
// ya firmado.
export const marcarAprobadoEnPdf = async (pdfInputBuffer) => {
  const pdfDoc = await PDFDocument.load(pdfInputBuffer, {
    ignoreEncryption: true,
    forIncrementalUpdate: true,
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
import nodemailer from "nodemailer";

//  CONFIGURACIÓN
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || "mail.hpvc.gob.ec",
  port: parseInt(process.env.SMTP_PORT) || 25,
  secure: process.env.SMTP_SECURE === "true" || false, // true para 465, false para 587
  auth: {
    user: process.env.SMTP_USER || "noreply@hpvc.gob.ec",
    pass: process.env.SMTP_PASS || "",
  },
  tls: {
    rejectUnauthorized: false, // para servidores con certificado autofirmado
  },
});

//  PLANTILLAS 
const plantillas = {
  nuevaSolicitudPermiso: ({
    jefe_nombre,
    servidor_nombre,
    cedula,
    unidad,
    fecha,
    tipo,
    horas,
    motivo,
  }) => ({
    subject: `[SITH] Nueva solicitud de permiso - ${servidor_nombre}`,
    html: `
      <div style="font-family: 'Segoe UI', Arial, sans-serif; max-width: 600px; margin: 0 auto; border: 1px solid #e5e7eb; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1);">
        <!-- Header -->
        <div style="background: linear-gradient(135deg, #1e40af 0%, #1d4ed8 100%); padding: 24px; text-align: center;">
          <div style="margin-bottom: 12px;">
            <span style="font-size: 40px;">🏥</span>
          </div>
          <h2 style="color: white; margin: 0; font-size: 20px;">Hospital Provincial Verdi Cevallos Balda</h2>
          <p style="color: #bfdbfe; margin: 8px 0 0; font-size: 13px;">Sistema de Talento Humano - SITH</p>
        </div>
        
        <!-- Content -->
        <div style="padding: 28px; background: white;">
          <div style="margin-bottom: 20px;">
            <span style="background: #dbeafe; color: #1e40af; padding: 4px 12px; border-radius: 20px; font-size: 12px; font-weight: 600;">🔔 NUEVA SOLICITUD</span>
          </div>
          
          <p style="color: #374151; margin: 0 0 16px; line-height: 1.5;">
            Estimado/a <strong style="color: #1e40af;">${jefe_nombre}</strong>,
          </p>
          
          <p style="color: #374151; margin: 0 0 20px; line-height: 1.5;">
            Tiene una nueva solicitud de permiso pendiente de aprobación:
          </p>
          
          <!-- Detalles de la solicitud -->
          <div style="background: #f8fafc; border-radius: 12px; padding: 20px; margin: 20px 0; border-left: 4px solid #3b82f6;">
            <table style="width: 100%; border-collapse: collapse;">
              <tr>
                <td style="padding: 8px 0; color: #64748b; font-size: 13px; width: 35%;">👤 Servidor:</td>
                <td style="padding: 8px 0; color: #1e293b; font-weight: 500; font-size: 14px;">${servidor_nombre}</td>
              </tr>
              ${
                cedula
                  ? `<tr>
                <td style="padding: 8px 0; color: #64748b; font-size: 13px;">🆔 Cédula:</td>
                <td style="padding: 8px 0; color: #1e293b; font-weight: 500; font-size: 14px;">${cedula}</td>
              </tr>`
                  : ""
              }
              ${
                unidad
                  ? `<tr>
                <td style="padding: 8px 0; color: #64748b; font-size: 13px;">🏢 Unidad:</td>
                <td style="padding: 8px 0; color: #1e293b; font-weight: 500; font-size: 14px;">${unidad}</td>
              </tr>`
                  : ""
              }
              <tr>
                <td style="padding: 8px 0; color: #64748b; font-size: 13px;">📋 Tipo:</td>
                <td style="padding: 8px 0; color: #1e293b; font-weight: 500; font-size: 14px;">${tipo}</td>
              </tr>
              <tr>
                <td style="padding: 8px 0; color: #64748b; font-size: 13px;">📅 Fecha:</td>
                <td style="padding: 8px 0; color: #1e293b; font-weight: 500; font-size: 14px;">${fecha}</td>
              </tr>
              <tr>
                <td style="padding: 8px 0; color: #64748b; font-size: 13px;">⏰ Horas:</td>
                <td style="padding: 8px 0; color: #1e293b; font-weight: 500; font-size: 14px;">${horas}</td>
              </tr>
              ${
                motivo
                  ? `<tr>
                <td style="padding: 8px 0; color: #64748b; font-size: 13px; vertical-align: top;">💬 Motivo:</td>
                <td style="padding: 8px 0; color: #1e293b; font-size: 13px;">${motivo}</td>
              </tr>`
                  : ""
              }
            </table>
          </div>
          
          <p style="color: #374151; margin: 0 0 24px; line-height: 1.5;">
            Por favor, ingrese al sistema SITH para revisar y responder esta solicitud.
          </p>
          
          <!-- Botón -->
          <div style="text-align: center; margin: 28px 0 16px;">
            <a href="${process.env.FRONTEND_URL}/permisos/bandeja" 
               style="display: inline-block; background: linear-gradient(135deg, #1e40af 0%, #1d4ed8 100%); color: white; padding: 12px 28px; border-radius: 8px; text-decoration: none; font-weight: 600; font-size: 14px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
              ✨ Ver Solicitud
            </a>
          </div>
        </div>
        
        <!-- Footer -->
        <div style="background: #f8fafc; padding: 16px 24px; text-align: center; border-top: 1px solid #e2e8f0;">
          <p style="color: #94a3b8; font-size: 11px; margin: 0 0 4px;">
            📧 Este es un correo automático del sistema SITH — No responder
          </p>
          <p style="color: #cbd5e1; font-size: 10px; margin: 0;">
            Hospital Verdi Cevallos Balda · Talento Humano
          </p>
        </div>
      </div>
    `,
  }),

  nuevaSolicitudVacacion: ({
    jefe_nombre,
    servidor_nombre,
    cedula,
    unidad,
    fecha_inicio,
    fecha_fin,
    dias,
    tipo,
    motivo,
  }) => ({
    subject: `[SITH] 🌴 Nueva solicitud de vacaciones - ${servidor_nombre}`,
    html: `
      <div style="font-family: 'Segoe UI', Arial, sans-serif; max-width: 600px; margin: 0 auto; border: 1px solid #e5e7eb; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1);">
        <!-- Header -->
        <div style="background: linear-gradient(135deg, #047857 0%, #059669 100%); padding: 24px; text-align: center;">
          <div style="margin-bottom: 12px;">
            <span style="font-size: 40px;">🌴</span>
          </div>
          <h2 style="color: white; margin: 0; font-size: 20px;">Hospital Provincial Verdi Cevallos Balda</h2>
          <p style="color: #a7f3d0; margin: 8px 0 0; font-size: 13px;">Sistema de Talento Humano - SITH</p>
        </div>
        
        <!-- Content -->
        <div style="padding: 28px; background: white;">
          <div style="margin-bottom: 20px;">
            <span style="background: #d1fae5; color: #065f46; padding: 4px 12px; border-radius: 20px; font-size: 12px; font-weight: 600;">🌴 NUEVA SOLICITUD DE VACACIONES</span>
          </div>
          
          <p style="color: #374151; margin: 0 0 16px; line-height: 1.5;">
            Estimado/a <strong style="color: #047857;">${jefe_nombre}</strong>,
          </p>
          
          <p style="color: #374151; margin: 0 0 20px; line-height: 1.5;">
            Tiene una nueva solicitud de vacaciones pendiente de aprobación:
          </p>
          
          <!-- Detalles de la solicitud -->
          <div style="background: #f0fdf4; border-radius: 12px; padding: 20px; margin: 20px 0; border-left: 4px solid #059669;">
            <table style="width: 100%; border-collapse: collapse;">
              <tr>
                <td style="padding: 8px 0; color: #64748b; font-size: 13px; width: 35%;">👤 Servidor:</td>
                <td style="padding: 8px 0; color: #1e293b; font-weight: 500; font-size: 14px;">${servidor_nombre}</td>
              </tr>
              ${
                cedula
                  ? `<tr>
                <td style="padding: 8px 0; color: #64748b; font-size: 13px;">🆔 Cédula:</td>
                <td style="padding: 8px 0; color: #1e293b; font-weight: 500; font-size: 14px;">${cedula}</td>
              </tr>`
                  : ""
              }
              ${
                unidad
                  ? `<tr>
                <td style="padding: 8px 0; color: #64748b; font-size: 13px;">🏢 Unidad:</td>
                <td style="padding: 8px 0; color: #1e293b; font-weight: 500; font-size: 14px;">${unidad}</td>
              </tr>`
                  : ""
              }
              <tr>
                <td style="padding: 8px 0; color: #64748b; font-size: 13px;">📋 Tipo:</td>
                <td style="padding: 8px 0; color: #1e293b; font-weight: 500; font-size: 14px;">${tipo === "VACACION_PROGRAMADA" ? "Vacación Programada" : "Permiso con Cargo"}</td>
              </tr>
              <tr>
                <td style="padding: 8px 0; color: #64748b; font-size: 13px;">📅 Período:</td>
                <td style="padding: 8px 0; color: #1e293b; font-weight: 500; font-size: 14px;">${fecha_inicio} → ${fecha_fin}</td>
              </tr>
              <tr>
                <td style="padding: 8px 0; color: #64748b; font-size: 13px;">⏱️ Días:</td>
                <td style="padding: 8px 0; color: #1e293b; font-weight: 500; font-size: 14px;">${dias} días</td>
              </tr>
              ${
                motivo
                  ? `<tr>
                <td style="padding: 8px 0; color: #64748b; font-size: 13px; vertical-align: top;">💬 Observación:</td>
                <td style="padding: 8px 0; color: #1e293b; font-size: 13px;">${motivo}</td>
              </tr>`
                  : ""
              }
            </table>
          </div>
          
          <p style="color: #374151; margin: 0 0 24px; line-height: 1.5;">
            Por favor, ingrese al sistema SITH para revisar y firmar esta solicitud.
          </p>
          
          <!-- Botón -->
          <div style="text-align: center; margin: 28px 0 16px;">
            <a href="${process.env.FRONTEND_URL}/permisos/bandeja-vacaciones" 
               style="display: inline-block; background: linear-gradient(135deg, #047857 0%, #059669 100%); color: white; padding: 12px 28px; border-radius: 8px; text-decoration: none; font-weight: 600; font-size: 14px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
              ✨ Ver Solicitud
            </a>
          </div>
        </div>
        
        <!-- Footer -->
        <div style="background: #f8fafc; padding: 16px 24px; text-align: center; border-top: 1px solid #e2e8f0;">
          <p style="color: #94a3b8; font-size: 11px; margin: 0 0 4px;">
            📧 Este es un correo automático del sistema SITH — No responder
          </p>
          <p style="color: #cbd5e1; font-size: 10px; margin: 0;">
            Hospital Verdi Cevallos Balda · Talento Humano
          </p>
        </div>
      </div>
    `,
  }),

  solicitudAprobada: ({
    servidor_nombre,
    tipo,
    fecha_inicio,
    fecha_fin,
    dias,
    aprobado_por,
  }) => ({
    subject: `[SITH] ✅ ¡Tu solicitud de vacaciones ha sido aprobada!`,
    html: `
      <div style="font-family: 'Segoe UI', Arial, sans-serif; max-width: 600px; margin: 0 auto; border: 1px solid #e5e7eb; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1);">
        <!-- Header -->
        <div style="background: linear-gradient(135deg, #047857 0%, #059669 100%); padding: 24px; text-align: center;">
          <div style="margin-bottom: 12px;">
            <span style="font-size: 48px;">✅</span>
          </div>
          <h2 style="color: white; margin: 0; font-size: 22px;">¡Solicitud Aprobada!</h2>
          <p style="color: #a7f3d0; margin: 8px 0 0; font-size: 13px;">Sistema de Talento Humano - SITH</p>
        </div>
        
        <!-- Content -->
        <div style="padding: 28px; background: white;">
          <p style="color: #374151; margin: 0 0 16px; line-height: 1.5;">
            Estimado/a <strong style="color: #047857;">${servidor_nombre}</strong>,
          </p>
          
          <p style="color: #374151; margin: 0 0 20px; line-height: 1.5;">
            Nos complace informarle que su solicitud de <strong>${tipo === "VACACION_PROGRAMADA" ? "vacaciones" : "permiso con cargo"}</strong> ha sido <strong style="color: #059669;">APROBADA</strong>.
          </p>
          
          <!-- Detalles -->
          <div style="background: #ecfdf5; border-radius: 12px; padding: 20px; margin: 20px 0; border: 1px solid #6ee7b7;">
            <div style="text-align: center; margin-bottom: 16px;">
              <span style="font-size: 32px;">🏖️</span>
            </div>
            <table style="width: 100%; border-collapse: collapse;">
              <tr>
                <td style="padding: 8px 0; color: #64748b; font-size: 13px; width: 40%;">📋 Tipo:</td>
                <td style="padding: 8px 0; color: #1e293b; font-weight: 500; font-size: 14px;">${tipo === "VACACION_PROGRAMADA" ? "Vacación Programada" : "Permiso con Cargo"}</td>
              </tr>
              <tr>
                <td style="padding: 8px 0; color: #64748b; font-size: 13px;">📅 Período:</td>
                <td style="padding: 8px 0; color: #1e293b; font-weight: 500; font-size: 14px;">${fecha_inicio} → ${fecha_fin}</td>
              </tr>
              <tr>
                <td style="padding: 8px 0; color: #64748b; font-size: 13px;">⏱️ Días aprobados:</td>
                <td style="padding: 8px 0; color: #059669; font-weight: 700; font-size: 16px;">${dias} días</td>
              </tr>
              ${
                aprobado_por
                  ? `<tr>
                <td style="padding: 8px 0; color: #64748b; font-size: 13px;">👔 Aprobado por:</td>
                <td style="padding: 8px 0; color: #1e293b; font-weight: 500; font-size: 14px;">${aprobado_por}</td>
              </tr>`
                  : ""
              }
            </table>
          </div>
          
          <div style="background: #f0fdf4; border-radius: 8px; padding: 12px; margin-top: 20px; text-align: center;">
            <p style="color: #065f46; font-size: 13px; margin: 0;">
              🎉 ¡Disfrute de sus merecidas vacaciones!
            </p>
          </div>
        </div>
        
        <!-- Footer -->
        <div style="background: #f8fafc; padding: 16px 24px; text-align: center; border-top: 1px solid #e2e8f0;">
          <p style="color: #94a3b8; font-size: 11px; margin: 0;">
            📧 Este es un correo automático del sistema SITH — No responder
          </p>
        </div>
      </div>
    `,
  }),

  solicitudNegada: ({ servidor_nombre, tipo, observacion, negado_por }) => ({
    subject: `[SITH] 📋 Actualización sobre su solicitud`,
    html: `
      <div style="font-family: 'Segoe UI', Arial, sans-serif; max-width: 600px; margin: 0 auto; border: 1px solid #e5e7eb; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1);">
        <!-- Header -->
        <div style="background: linear-gradient(135deg, #b91c1c 0%, #dc2626 100%); padding: 24px; text-align: center;">
          <div style="margin-bottom: 12px;">
            <span style="font-size: 40px;">📋</span>
          </div>
          <h2 style="color: white; margin: 0; font-size: 20px;">Solicitud No Aprobada</h2>
          <p style="color: #fecaca; margin: 8px 0 0; font-size: 13px;">Sistema de Talento Humano - SITH</p>
        </div>
        
        <!-- Content -->
        <div style="padding: 28px; background: white;">
          <p style="color: #374151; margin: 0 0 16px; line-height: 1.5;">
            Estimado/a <strong style="color: #b91c1c;">${servidor_nombre}</strong>,
          </p>
          
          <p style="color: #374151; margin: 0 0 20px; line-height: 1.5;">
          </p>
          
          <!-- Detalles -->
          <div style="background: #fef2f2; border-radius: 12px; padding: 20px; margin: 20px 0; border: 1px solid #fca5a5;">
            <p style="margin: 0 0 8px; color: #991b1b; font-weight: 600;">Motivo de la negación:</p>
            <p style="margin: 0; color: #7f1d1d; line-height: 1.5;">${observacion || "No se especificó un motivo."}</p>
          </div>
          
          ${
            negado_por
              ? `
          <div style="background: #f8fafc; border-radius: 8px; padding: 12px; margin: 16px 0;">
            <p style="color: #64748b; font-size: 12px; margin: 0;">
              👔 Negado por: <strong>${negado_por}</strong>
            </p>
          </div>
          `
              : ""
          }
          
          <div style="background: #fef2f2; border-radius: 8px; padding: 12px; margin-top: 20px; text-align: center;">
            <p style="color: #991b1b; font-size: 13px; margin: 0;">
              📞 Para más información, comuníquese con la Unidad de Talento Humano.
            </p>
          </div>
        </div>
        
        <!-- Footer -->
        <div style="background: #f8fafc; padding: 16px 24px; text-align: center; border-top: 1px solid #e2e8f0;">
          <p style="color: #94a3b8; font-size: 11px; margin: 0;">
            📧 Este es un correo automático del sistema SITH — No responder
          </p>
        </div>
      </div>
    `,
  }),

  permisoAprobado: ({
    servidor_nombre,
    cedula,
    tipo,
    fecha,
    horas,
    aprobado_por,
  }) => ({
    subject: `[SITH] ✅ Su permiso ha sido aprobado`,
    html: `
      <div style="font-family: 'Segoe UI', Arial, sans-serif; max-width: 600px; margin: 0 auto; border: 1px solid #e5e7eb; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1);">
        <!-- Header -->
        <div style="background: linear-gradient(135deg, #1e40af 0%, #3b82f6 100%); padding: 24px; text-align: center;">
          <div style="margin-bottom: 12px;">
            <span style="font-size: 40px;">✅</span>
          </div>
          <h2 style="color: white; margin: 0; font-size: 20px;">¡Permiso Aprobado!</h2>
          <p style="color: #bfdbfe; margin: 8px 0 0; font-size: 13px;">Sistema de Talento Humano - SITH</p>
        </div>
        
        <!-- Content -->
        <div style="padding: 28px; background: white;">
          <p style="color: #374151; margin: 0 0 16px; line-height: 1.5;">
            Estimado/a <strong style="color: #1e40af;">${servidor_nombre}</strong>,
          </p>
          
          <p style="color: #374151; margin: 0 0 20px; line-height: 1.5;">
          </p>
          
          <!-- Detalles -->
          <div style="background: #eff6ff; border-radius: 12px; padding: 20px; margin: 20px 0; border-left: 4px solid #3b82f6;">
            <table style="width: 100%; border-collapse: collapse;">
              ${
                cedula
                  ? `<tr>
                <td style="padding: 8px 0; color: #64748b; font-size: 13px; width: 35%;">🆔 Cédula:</td>
                <td style="padding: 8px 0; color: #1e293b; font-weight: 500; font-size: 14px;">${cedula}</td>
              </tr>`
                  : ""
              }
              <tr>
                <td style="padding: 8px 0; color: #64748b; font-size: 13px;">📋 Tipo:</td>
                <td style="padding: 8px 0; color: #1e293b; font-weight: 500; font-size: 14px;">${tipo}</td>
              </tr>
              <tr>
                <td style="padding: 8px 0; color: #64748b; font-size: 13px;">📅 Fecha:</td>
                <td style="padding: 8px 0; color: #1e293b; font-weight: 500; font-size: 14px;">${fecha}</td>
              </tr>
              <tr>
                <td style="padding: 8px 0; color: #64748b; font-size: 13px;">⏰ Horas aprobadas:</td>
                <td style="padding: 8px 0; color: #059669; font-weight: 700; font-size: 14px;">${horas}</td>
              </tr>
              ${
                aprobado_por
                  ? `<tr>
                <td style="padding: 8px 0; color: #64748b; font-size: 13px;">👔 Aprobado por:</td>
                <td style="padding: 8px 0; color: #1e293b; font-weight: 500; font-size: 14px;">${aprobado_por}</td>
              </tr>`
                  : ""
              }
            </table>
          </div>
        </div>
        
        <!-- Footer -->
        <div style="background: #f8fafc; padding: 16px 24px; text-align: center; border-top: 1px solid #e2e8f0;">
          <p style="color: #94a3b8; font-size: 11px; margin: 0;">
            📧 Este es un correo automático del sistema SITH — No responder
          </p>
        </div>
      </div>
    `,
  }),
};

// FUNCIÓN PRINCIPAL 
export const enviarCorreo = async (destinatario, plantilla, datos) => {
  try {
    if (!destinatario || !destinatario.includes("@")) {
      console.log(`[EMAIL] Sin correo para: ${destinatario}`);
      return false;
    }

    const { subject, html } = plantillas[plantilla](datos);

    await transporter.sendMail({
      from: `"SITH - Talento Humano HPVCB" <${process.env.SMTP_USER || "noreply@hpvc.gob.ec"}>`,
      to: destinatario,
      subject,
      html,
    });

    console.log(`[EMAIL] ✅ Enviado a ${destinatario} - ${subject}`);
    return true;
  } catch (err) {
    console.error(`[EMAIL] ❌ Error enviando a ${destinatario}:`, err.message);
    return false; // No lanzar error — el correo es opcional, no crítico
  }
};

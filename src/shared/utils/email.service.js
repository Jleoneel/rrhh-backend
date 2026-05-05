import nodemailer from "nodemailer";

//  CONFIGURACIÓN
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || "mail.hpvc.gob.ec",
  port: parseInt(process.env.SMTP_PORT) || 25,
  secure: process.env.SMTP_SECURE === "true" || false,
  auth: {
    user: process.env.SMTP_USER || "noreply@hpvc.gob.ec",
    pass: process.env.SMTP_PASS || "",
  },
  tls: {
    rejectUnauthorized: false,
  },
});

//  COLORES INSTITUCIONALES
const COLORS = {
  primary: "#1e40af",      
  primaryLight: "#3b82f6", 
  secondary: "#059669",     // Verde institucional
  secondaryLight: "#10b981",// Verde claro
  danger: "#dc2626",        // Rojo para negaciones
  warning: "#f59e0b",       // Amarillo para alertas
  text: "#1f2937",          // Texto oscuro
  textLight: "#6b7280",     // Texto gris
  background: "#f8fafc",    // Fondo gris claro
  white: "#ffffff",
  border: "#e5e7eb",
};

//  PLANTILLAS MEJORADAS
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
      <div style="font-family: 'Segoe UI', Arial, sans-serif; max-width: 600px; margin: 0 auto; border: 1px solid ${COLORS.border}; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1);">
        <!-- Header -->
        <div style="background: linear-gradient(135deg, ${COLORS.primary} 0%, ${COLORS.primaryLight} 100%); padding: 28px 24px; text-align: center;">
          <div style="margin-bottom: 16px;">
            <img src="http://186.47.77.45:8082/syshpvc/" alt="Hospital Logo" style="height: 60px; width: auto;" />
          </div>
          <h2 style="color: ${COLORS.white}; margin: 0; font-size: 18px; font-weight: 600;">Hospital Provincial de Portoviejo</h2>
          <p style="color: ${COLORS.white}; margin: 4px 0 0; font-size: 14px; font-weight: 500;">Dr. Verdi Cevallos Balda</p>
          <p style="color: rgba(255,255,255,0.8); margin: 8px 0 0; font-size: 12px;">Sistema de Talento Humano - SITH</p>
        </div>
        
        <!-- Content -->
        <div style="padding: 28px; background: ${COLORS.white};">
          <div style="margin-bottom: 24px;">
            <span style="background: ${COLORS.primary}10; color: ${COLORS.primary}; padding: 4px 12px; border-radius: 20px; font-size: 12px; font-weight: 600;">NUEVA SOLICITUD</span>
          </div>
          
          <p style="color: ${COLORS.text}; margin: 0 0 20px; line-height: 1.5;">
            Estimado/a <strong style="color: ${COLORS.primary};">${jefe_nombre}</strong>,
          </p>
          
          <p style="color: ${COLORS.text}; margin: 0 0 20px; line-height: 1.5;">
            Tiene una nueva solicitud de permiso pendiente de aprobación:
          </p>
          
          <div style="background: ${COLORS.background}; border-radius: 12px; padding: 20px; margin: 24px 0; border-left: 4px solid ${COLORS.primary};">
            <table style="width: 100%; border-collapse: collapse;">
              <tr>
                <td style="padding: 8px 0; color: ${COLORS.textLight}; font-size: 13px; width: 35%;">Servidor:</td>
                <td style="padding: 8px 0; color: ${COLORS.text}; font-weight: 500; font-size: 14px;">${servidor_nombre}</td>
              </tr>
              ${cedula ? `
              <tr>
                <td style="padding: 8px 0; color: ${COLORS.textLight}; font-size: 13px;">Cédula:</td>
                <td style="padding: 8px 0; color: ${COLORS.text}; font-weight: 500; font-size: 14px;">${cedula}</td>
              </tr>` : ''}
              ${unidad ? `
              <tr>
                <td style="padding: 8px 0; color: ${COLORS.textLight}; font-size: 13px;">Unidad:</td>
                <td style="padding: 8px 0; color: ${COLORS.text}; font-weight: 500; font-size: 14px;">${unidad}</td>
              </tr>` : ''}
              <tr>
                <td style="padding: 8px 0; color: ${COLORS.textLight}; font-size: 13px;">Tipo:</td>
                <td style="padding: 8px 0; color: ${COLORS.text}; font-weight: 500; font-size: 14px;">${tipo}</td>
              </tr>
              <tr>
                <td style="padding: 8px 0; color: ${COLORS.textLight}; font-size: 13px;">Fecha:</td>
                <td style="padding: 8px 0; color: ${COLORS.text}; font-weight: 500; font-size: 14px;">${fecha}</td>
              </tr>
              <tr>
                <td style="padding: 8px 0; color: ${COLORS.textLight}; font-size: 13px;">Horas:</td>
                <td style="padding: 8px 0; color: ${COLORS.text}; font-weight: 500; font-size: 14px;">${horas}</td>
              </tr>
              ${motivo ? `
              <tr>
                <td style="padding: 8px 0; color: ${COLORS.textLight}; font-size: 13px; vertical-align: top;">Motivo:</td>
                <td style="padding: 8px 0; color: ${COLORS.text}; font-size: 13px;">${motivo}</td>
              </tr>` : ''}
            </table>
          </div>
          
          <p style="color: ${COLORS.text}; margin: 0 0 24px; line-height: 1.5;">
            Por favor, ingrese al sistema SITH para revisar y responder esta solicitud.
          </p>
          
          <div style="text-align: center; margin: 28px 0 16px;">
            <a href="${process.env.FRONTEND_URL}/permisos/bandeja" 
               style="display: inline-block; background: linear-gradient(135deg, ${COLORS.primary} 0%, ${COLORS.primaryLight} 100%); color: ${COLORS.white}; padding: 12px 28px; border-radius: 8px; text-decoration: none; font-weight: 600; font-size: 14px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
              Ver Solicitud
            </a>
          </div>
        </div>
        
        <div style="background: ${COLORS.background}; padding: 16px 24px; text-align: center; border-top: 1px solid ${COLORS.border};">
          <p style="color: ${COLORS.textLight}; font-size: 11px; margin: 0;">
            Este es un correo automático del sistema SITH — No responder
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
    subject: `[SITH] Nueva solicitud de vacaciones - ${servidor_nombre}`,
    html: `
      <div style="font-family: 'Segoe UI', Arial, sans-serif; max-width: 600px; margin: 0 auto; border: 1px solid ${COLORS.border}; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1);">
        <div style="background: linear-gradient(135deg, ${COLORS.secondary} 0%, ${COLORS.secondaryLight} 100%); padding: 28px 24px; text-align: center;">
          <div style="margin-bottom: 16px;">
            <img src="http://186.47.77.45:8082/syshpvc/" alt="Hospital Logo" style="height: 60px; width: auto;" />
          </div>
          <h2 style="color: ${COLORS.white}; margin: 0; font-size: 18px; font-weight: 600;">Hospital Provincial de Portoviejo</h2>
          <p style="color: ${COLORS.white}; margin: 4px 0 0; font-size: 14px; font-weight: 500;">Dr. Verdi Cevallos Balda</p>
          <p style="color: rgba(255,255,255,0.8); margin: 8px 0 0; font-size: 12px;">Sistema de Talento Humano - SITH</p>
        </div>
        
        <div style="padding: 28px; background: ${COLORS.white};">
          <div style="margin-bottom: 24px;">
            <span style="background: ${COLORS.secondary}10; color: ${COLORS.secondary}; padding: 4px 12px; border-radius: 20px; font-size: 12px; font-weight: 600;">NUEVA SOLICITUD DE VACACIONES</span>
          </div>
          
          <p style="color: ${COLORS.text}; margin: 0 0 20px; line-height: 1.5;">
            Estimado/a <strong style="color: ${COLORS.secondary};">${jefe_nombre}</strong>,
          </p>
          
          <p style="color: ${COLORS.text}; margin: 0 0 20px; line-height: 1.5;">
            Tiene una nueva solicitud de vacaciones pendiente de aprobación:
          </p>
          
          <div style="background: ${COLORS.background}; border-radius: 12px; padding: 20px; margin: 24px 0; border-left: 4px solid ${COLORS.secondary};">
            <table style="width: 100%; border-collapse: collapse;">
              <tr>
                <td style="padding: 8px 0; color: ${COLORS.textLight}; font-size: 13px; width: 35%;">Servidor:</td>
                <td style="padding: 8px 0; color: ${COLORS.text}; font-weight: 500; font-size: 14px;">${servidor_nombre}</td>
              </tr>
              ${cedula ? `
              <tr>
                <td style="padding: 8px 0; color: ${COLORS.textLight}; font-size: 13px;">Cédula:</td>
                <td style="padding: 8px 0; color: ${COLORS.text}; font-weight: 500; font-size: 14px;">${cedula}</td>
              </tr>` : ''}
              ${unidad ? `
              <tr>
                <td style="padding: 8px 0; color: ${COLORS.textLight}; font-size: 13px;">Unidad:</td>
                <td style="padding: 8px 0; color: ${COLORS.text}; font-weight: 500; font-size: 14px;">${unidad}</td>
              </tr>` : ''}
              <tr>
                <td style="padding: 8px 0; color: ${COLORS.textLight}; font-size: 13px;">Tipo:</td>
                <td style="padding: 8px 0; color: ${COLORS.text}; font-weight: 500; font-size: 14px;">${tipo === "VACACION_PROGRAMADA" ? "Vacación Programada" : "Permiso con Cargo"}</td>
              </tr>
              <tr>
                <td style="padding: 8px 0; color: ${COLORS.textLight}; font-size: 13px;">Período:</td>
                <td style="padding: 8px 0; color: ${COLORS.text}; font-weight: 500; font-size: 14px;">${fecha_inicio} → ${fecha_fin}</td>
              </tr>
              <tr>
                <td style="padding: 8px 0; color: ${COLORS.textLight}; font-size: 13px;">Días:</td>
                <td style="padding: 8px 0; color: ${COLORS.text}; font-weight: 500; font-size: 14px;">${dias} días</td>
              </tr>
              ${motivo ? `
              <tr>
                <td style="padding: 8px 0; color: ${COLORS.textLight}; font-size: 13px; vertical-align: top;">Observación:</td>
                <td style="padding: 8px 0; color: ${COLORS.text}; font-size: 13px;">${motivo}</td>
              </tr>` : ''}
            </table>
          </div>
          
          <p style="color: ${COLORS.text}; margin: 0 0 24px; line-height: 1.5;">
            Por favor, ingrese al sistema SITH para revisar y firmar esta solicitud.
          </p>
          
          <div style="text-align: center; margin: 28px 0 16px;">
            <a href="${process.env.FRONTEND_URL}/permisos/bandeja-vacaciones" 
               style="display: inline-block; background: linear-gradient(135deg, ${COLORS.secondary} 0%, ${COLORS.secondaryLight} 100%); color: ${COLORS.white}; padding: 12px 28px; border-radius: 8px; text-decoration: none; font-weight: 600; font-size: 14px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
              Ver Solicitud
            </a>
          </div>
        </div>
        
        <div style="background: ${COLORS.background}; padding: 16px 24px; text-align: center; border-top: 1px solid ${COLORS.border};">
          <p style="color: ${COLORS.textLight}; font-size: 11px; margin: 0;">
            Este es un correo automático del sistema SITH — No responder
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
    subject: `[SITH] Su solicitud de vacaciones ha sido aprobada - ${servidor_nombre}`,
    html: `
      <div style="font-family: 'Segoe UI', Arial, sans-serif; max-width: 600px; margin: 0 auto; border: 1px solid ${COLORS.border}; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1);">
        <div style="background: linear-gradient(135deg, ${COLORS.secondary} 0%, ${COLORS.secondaryLight} 100%); padding: 28px 24px; text-align: center;">
          <div style="margin-bottom: 16px;">
            <img src="http://186.47.77.45:8082/syshpvc" alt="Hospital Logo" style="height: 60px; width: auto;" />
          </div>
          <h2 style="color: ${COLORS.white}; margin: 0; font-size: 18px; font-weight: 600;">Hospital Provincial de Portoviejo</h2>
          <p style="color: ${COLORS.white}; margin: 4px 0 0; font-size: 14px; font-weight: 500;">Dr. Verdi Cevallos Balda</p>
          <p style="color: rgba(255,255,255,0.8); margin: 8px 0 0; font-size: 12px;">Sistema de Talento Humano - SITH</p>
        </div>
        
        <div style="padding: 28px; background: ${COLORS.white};">
          <p style="color: ${COLORS.text}; margin: 0 0 20px; line-height: 1.5;">
            Estimado/a <strong style="color: ${COLORS.secondary};">${servidor_nombre}</strong>,
          </p>
          
          <p style="color: ${COLORS.text}; margin: 0 0 20px; line-height: 1.5;">
            Nos complace informarle que su solicitud de <strong>${tipo === "VACACION_PROGRAMADA" ? "vacaciones" : "permiso con cargo"}</strong> ha sido <strong style="color: ${COLORS.secondary};">APROBADA</strong>.
          </p>
          
          <div style="background: ${COLORS.background}; border-radius: 12px; padding: 20px; margin: 24px 0; border: 1px solid ${COLORS.secondary}20;">
            <table style="width: 100%; border-collapse: collapse;">
              <tr>
                <td style="padding: 8px 0; color: ${COLORS.textLight}; font-size: 13px; width: 40%;">Tipo:</td>
                <td style="padding: 8px 0; color: ${COLORS.text}; font-weight: 500; font-size: 14px;">${tipo === "VACACION_PROGRAMADA" ? "Vacación Programada" : "Permiso con Cargo"}</td>
              </tr>
              <tr>
                <td style="padding: 8px 0; color: ${COLORS.textLight}; font-size: 13px;">Período:</td>
                <td style="padding: 8px 0; color: ${COLORS.text}; font-weight: 500; font-size: 14px;">${fecha_inicio} → ${fecha_fin}</td>
              </tr>
              <tr>
                <td style="padding: 8px 0; color: ${COLORS.textLight}; font-size: 13px;">Días aprobados:</td>
                <td style="padding: 8px 0; color: ${COLORS.secondary}; font-weight: 700; font-size: 16px;">${dias} días</td>
              </tr>
              ${aprobado_por ? `
              <tr>
                <td style="padding: 8px 0; color: ${COLORS.textLight}; font-size: 13px;">Aprobado por:</td>
                <td style="padding: 8px 0; color: ${COLORS.text}; font-weight: 500; font-size: 14px;">${aprobado_por}</td>
              </tr>` : ''}
            </table>
          </div>
          
          <div style="background: ${COLORS.secondary}10; border-radius: 8px; padding: 12px; margin-top: 20px; text-align: center;">
            <p style="color: ${COLORS.secondary}; font-size: 13px; margin: 0;">
              Disfrute de sus merecidas vacaciones
            </p>
          </div>
        </div>
        
        <div style="background: ${COLORS.background}; padding: 16px 24px; text-align: center; border-top: 1px solid ${COLORS.border};">
          <p style="color: ${COLORS.textLight}; font-size: 11px; margin: 0;">
            Este es un correo automático del sistema SITH — No responder
          </p>
        </div>
      </div>
    `,
  }),

  solicitudNegada: ({ servidor_nombre, tipo, observacion, negado_por }) => ({
    subject: `[SITH] Actualización sobre su solicitud - ${servidor_nombre}`,
    html: `
      <div style="font-family: 'Segoe UI', Arial, sans-serif; max-width: 600px; margin: 0 auto; border: 1px solid ${COLORS.border}; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1);">
        <div style="background: linear-gradient(135deg, ${COLORS.danger} 0%, #ef4444 100%); padding: 28px 24px; text-align: center;">
          <div style="margin-bottom: 16px;">
            <img src="http://186.47.77.45:8082/syshpvc/" alt="Hospital Logo" style="height: 60px; width: auto;" />
          </div>
          <h2 style="color: ${COLORS.white}; margin: 0; font-size: 18px; font-weight: 600;">Hospital Provincial de Portoviejo</h2>
          <p style="color: ${COLORS.white}; margin: 4px 0 0; font-size: 14px; font-weight: 500;">Dr. Verdi Cevallos Balda</p>
          <p style="color: rgba(255,255,255,0.8); margin: 8px 0 0; font-size: 12px;">Sistema de Talento Humano - SITH</p>
        </div>
        
        <div style="padding: 28px; background: ${COLORS.white};">
          <p style="color: ${COLORS.text}; margin: 0 0 20px; line-height: 1.5;">
            Estimado/a <strong style="color: ${COLORS.danger};">${servidor_nombre}</strong>,
          </p>
          
          <p style="color: ${COLORS.text}; margin: 0 0 20px; line-height: 1.5;">
            Le informamos que su solicitud de <strong>${tipo}</strong> ha sido <strong style="color: ${COLORS.danger};">negada</strong>.
          </p>
          
          <div style="background: ${COLORS.danger}10; border-radius: 12px; padding: 20px; margin: 24px 0; border: 1px solid ${COLORS.danger}30;">
            <p style="margin: 0 0 8px; color: ${COLORS.danger}; font-weight: 600;">Motivo:</p>
            <p style="margin: 0; color: ${COLORS.text}; line-height: 1.5;">${observacion || "No se especificó un motivo."}</p>
          </div>
          
          ${negado_por ? `
          <div style="background: ${COLORS.background}; border-radius: 8px; padding: 12px; margin: 16px 0;">
            <p style="color: ${COLORS.textLight}; font-size: 12px; margin: 0;">
              Negado por: <strong>${negado_por}</strong>
            </p>
          </div>` : ''}
          
          <div style="background: ${COLORS.danger}10; border-radius: 8px; padding: 12px; margin-top: 20px; text-align: center;">
            <p style="color: ${COLORS.danger}; font-size: 12px; margin: 0;">
              Para más información, comuníquese con la Unidad de Talento Humano
            </p>
          </div>
        </div>
        
        <div style="background: ${COLORS.background}; padding: 16px 24px; text-align: center; border-top: 1px solid ${COLORS.border};">
          <p style="color: ${COLORS.textLight}; font-size: 11px; margin: 0;">
            Este es un correo automático del sistema SITH — No responder
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
    subject: `[SITH] Su permiso ha sido aprobado - ${servidor_nombre}`,
    html: `
      <div style="font-family: 'Segoe UI', Arial, sans-serif; max-width: 600px; margin: 0 auto; border: 1px solid ${COLORS.border}; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1);">
        <div style="background: linear-gradient(135deg, ${COLORS.primary} 0%, ${COLORS.primaryLight} 100%); padding: 28px 24px; text-align: center;">
          <div style="margin-bottom: 16px;">
            <img src="http://186.47.77.45:8082/syshpvc/" alt="Hospital Logo" style="height: 60px; width: auto;" />
          </div>
          <h2 style="color: ${COLORS.white}; margin: 0; font-size: 18px; font-weight: 600;">Hospital Provincial de Portoviejo</h2>
          <p style="color: ${COLORS.white}; margin: 4px 0 0; font-size: 14px; font-weight: 500;">Dr. Verdi Cevallos Balda</p>
          <p style="color: rgba(255,255,255,0.8); margin: 8px 0 0; font-size: 12px;">Sistema de Talento Humano - SITH</p>
        </div>
        
        <div style="padding: 28px; background: ${COLORS.white};">
          <p style="color: ${COLORS.text}; margin: 0 0 20px; line-height: 1.5;">
            Estimado/a <strong style="color: ${COLORS.primary};">${servidor_nombre}</strong>,
          </p>
          
          <p style="color: ${COLORS.text}; margin: 0 0 20px; line-height: 1.5;">
            Le informamos que su permiso ha sido <strong style="color: ${COLORS.secondary};">APROBADO</strong>.
          </p>
          
          <div style="background: ${COLORS.background}; border-radius: 12px; padding: 20px; margin: 24px 0; border-left: 4px solid ${COLORS.primary};">
            <table style="width: 100%; border-collapse: collapse;">
              ${cedula ? `
              <tr>
                <td style="padding: 8px 0; color: ${COLORS.textLight}; font-size: 13px; width: 35%;">Cédula:</td>
                <td style="padding: 8px 0; color: ${COLORS.text}; font-weight: 500; font-size: 14px;">${cedula}</td>
              </tr>` : ''}
              <tr>
                <td style="padding: 8px 0; color: ${COLORS.textLight}; font-size: 13px;">Tipo:</td>
                <td style="padding: 8px 0; color: ${COLORS.text}; font-weight: 500; font-size: 14px;">${tipo}</td>
              </tr>
              <tr>
                <td style="padding: 8px 0; color: ${COLORS.textLight}; font-size: 13px;">Fecha:</td>
                <td style="padding: 8px 0; color: ${COLORS.text}; font-weight: 500; font-size: 14px;">${fecha}</td>
              </tr>
              <tr>
                <td style="padding: 8px 0; color: ${COLORS.textLight}; font-size: 13px;">Horas aprobadas:</td>
                <td style="padding: 8px 0; color: ${COLORS.secondary}; font-weight: 700; font-size: 14px;">${horas}</td>
              </tr>
              ${aprobado_por ? `
              <tr>
                <td style="padding: 8px 0; color: ${COLORS.textLight}; font-size: 13px;">Aprobado por:</td>
                <td style="padding: 8px 0; color: ${COLORS.text}; font-weight: 500; font-size: 14px;">${aprobado_por}</td>
              </tr>` : ''}
            </table>
          </div>
        </div>
        
        <div style="background: ${COLORS.background}; padding: 16px 24px; text-align: center; border-top: 1px solid ${COLORS.border};">
          <p style="color: ${COLORS.textLight}; font-size: 11px; margin: 0;">
            Este es un correo automático del sistema SITH — No responder
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

    console.log(`[EMAIL] Enviado a ${destinatario} - ${subject}`);
    return true;
  } catch (err) {
    console.error(`[EMAIL] Error enviando a ${destinatario}:`, err.message);
    return false;
  }
};
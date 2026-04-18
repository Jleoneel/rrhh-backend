import { useEffect, useState } from "react";
import { useAuth } from "../../auth/AuthContext";
import {
  getMiSaldo,
  getMisVacaciones,
  solicitarVacacion,
  cancelarVacacion,
} from "../hooks/permisos.service";
import {
  Clock,
  Calendar,
  CheckCircle2,
  XCircle,
  AlertCircle,
  Plus,
  RefreshCw,
  Loader2,
  FileText,
  Send,
  X,
  Trash2,
  ChevronDown,
} from "lucide-react";
import Swal from "sweetalert2";

const estadoBadge = (estado) => {
  const map = {
    PENDIENTE_JEFE: "bg-yellow-100 text-yellow-800 border border-yellow-200",
    PENDIENTE_GERENTE: "bg-orange-100 text-orange-800 border border-orange-200",
    PENDIENTE_UATH: "bg-blue-100 text-blue-800 border border-blue-200",
    APROBADO: "bg-green-100 text-green-800 border border-green-200",
    NEGADO: "bg-red-100 text-red-800 border border-red-200",
  };
  const labels = {
    PENDIENTE_JEFE: "Pendiente Jefe",
    PENDIENTE_GERENTE: "Pendiente Jefe superior",
    PENDIENTE_UATH: "Pendiente UATH",
    APROBADO: "Aprobado",
    NEGADO: "Negado",
  };
  const icons = {
    PENDIENTE_JEFE: <Clock size={11} />,
    PENDIENTE_GERENTE: <Clock size={11} />,
    PENDIENTE_UATH: <Clock size={11} />,
    APROBADO: <CheckCircle2 size={11} />,
    NEGADO: <XCircle size={11} />,
  };
  return (
    <span
      className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium ${map[estado] || "bg-gray-100 text-gray-600"}`}
    >
      {icons[estado]} {labels[estado] || estado}
    </span>
  );
};

const initialForm = {
  tipo: "",
  fecha_inicio: "",
  fecha_fin: "",
  dias_solicitados: "",
  telefono_domicilio: "",
  telefono_movil: "",
};

export default function VacacionesServidor() {
  const { user } = useAuth();
  const [saldo, setSaldo] = useState(null);
  const [vacaciones, setVacaciones] = useState([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [form, setForm] = useState(initialForm);
  const [submitting, setSubmitting] = useState(false);

  const cargarDatos = async () => {
    setLoading(true);
    try {
      const [saldoData, vacacionesData] = await Promise.all([
        getMiSaldo(),
        getMisVacaciones(),
      ]);
      setSaldo(saldoData);
      setVacaciones(vacacionesData);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    cargarDatos();
  }, []);

  // Calcular días automáticamente al cambiar fechas
  useEffect(() => {
    if (form.fecha_inicio && form.fecha_fin) {
      const inicio = new Date(form.fecha_inicio);
      const fin = new Date(form.fecha_fin);
      if (fin >= inicio) {
        const diff = Math.ceil((fin - inicio) / (1000 * 60 * 60 * 24)) + 1;
        setForm((p) => ({ ...p, dias_solicitados: diff }));
      }
    }
  }, [form.fecha_inicio, form.fecha_fin]);

  const horasADias = (horas) => (parseFloat(horas || 0) / 8).toFixed(1);

  const tienePendiente = vacaciones.some(
    (v) => !["APROBADO", "NEGADO"].includes(v.estado),
  );

  const handleSubmit = async () => {
    if (
      !form.tipo ||
      !form.fecha_inicio ||
      !form.fecha_fin ||
      !form.dias_solicitados
    ) {
      Swal.fire({
        toast: true,
        icon: "warning",
        text: "Completa todos los campos",
        timer: 2000,
        showConfirmButton: false,
        position: "top-end",
      });
      return;
    }

    if (!form.telefono_movil || form.telefono_movil.trim().length < 10) {
      Swal.fire({
        toast: true,
        icon: "warning",
        text: "El teléfono móvil es obligatorio (mínimo 10 dígitos)",
        timer: 2500,
        showConfirmButton: false,
        position: "top-end",
      });
      return;
    }

    if (new Date(form.fecha_fin) < new Date(form.fecha_inicio)) {
      Swal.fire({
        toast: true,
        icon: "error",
        text: "La fecha fin debe ser posterior a la fecha inicio",
        timer: 2000,
        showConfirmButton: false,
        position: "top-end",
      });
      return;
    }

    const diasDisponibles = parseFloat(saldo?.horas_disponibles || 0) / 8;
    if (parseFloat(form.dias_solicitados) > diasDisponibles) {
      Swal.fire({
        toast: true,
        icon: "error",
        text: `Saldo insuficiente. Disponible: ${diasDisponibles.toFixed(1)} días`,
        timer: 2500,
        showConfirmButton: false,
        position: "top-end",
      });
      return;
    }

    const confirm = await Swal.fire({
      title: "¿Enviar solicitud de vacaciones?",
      html: `
        <div class="text-left space-y-3 p-2">
          <div class="flex justify-between border-b pb-2">
            <span class="text-gray-600">Tipo:</span>
            <span class="font-semibold">${form.tipo === "VACACION_PROGRAMADA" ? "Vacación Programada" : "Permiso con Cargo"}</span>
          </div>
          <div class="flex justify-between border-b pb-2">
            <span class="text-gray-600">Desde:</span>
            <span class="font-semibold">${new Date(form.fecha_inicio + "T12:00:00").toLocaleDateString("es-ES", { day: "2-digit", month: "long", year: "numeric" })}</span>
          </div>
          <div class="flex justify-between border-b pb-2">
            <span class="text-gray-600">Hasta:</span>
            <span class="font-semibold">${new Date(form.fecha_fin + "T12:00:00").toLocaleDateString("es-ES", { day: "2-digit", month: "long", year: "numeric" })}</span>
          </div>
          <div class="flex justify-between">
            <span class="text-gray-600">Días:</span>
            <span class="font-semibold text-blue-600">${form.dias_solicitados} días</span>
          </div>
        </div>
      `,
      icon: "question",
      showCancelButton: true,
      confirmButtonText: "Sí, enviar",
      cancelButtonText: "Revisar",
      confirmButtonColor: "#3b82f6",
      cancelButtonColor: "#6b7280",
    });

    if (!confirm.isConfirmed) return;

    setSubmitting(true);
    try {
      await solicitarVacacion(form);
      Swal.fire({
        toast: true,
        icon: "success",
        text: "Solicitud enviada correctamente",
        timer: 2000,
        showConfirmButton: false,
        position: "top-end",
      });
      setModalOpen(false);
      setForm(initialForm);
      cargarDatos();
    } catch (err) {
      Swal.fire({
        icon: "error",
        title: "Error",
        text: err.response?.data?.message || "No se pudo enviar",
        confirmButtonColor: "#ef4444",
      });
    } finally {
      setSubmitting(false);
    }
  };

  const handleCancelar = async (vacacion) => {
    const confirm = await Swal.fire({
      title: "¿Cancelar solicitud?",
      text: "Esta acción no se puede deshacer",
      icon: "warning",
      showCancelButton: true,
      confirmButtonText: "Sí, cancelar",
      cancelButtonText: "No",
      confirmButtonColor: "#dc2626",
      cancelButtonColor: "#6b7280",
    });

    if (!confirm.isConfirmed) return;

    try {
      await cancelarVacacion(vacacion.id);
      Swal.fire({
        toast: true,
        icon: "success",
        text: "Solicitud cancelada",
        timer: 2000,
        showConfirmButton: false,
        position: "top-end",
      });
      cargarDatos();
    } catch (err) {
      Swal.fire({
        icon: "error",
        title: "Error",
        text: err.response?.data?.message || "No se pudo cancelar",
        confirmButtonColor: "#ef4444",
      });
    }
  };

  const porcentajeUsado = saldo
    ? Math.round((saldo.horas_usadas / saldo.horas_totales) * 100)
    : 0;

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-blue-50 p-8">
      <div className="max-w-5xl mx-auto">
        {/* Header */}
        <div className="mb-10 flex items-center gap-4">
          <div className="p-4 bg-gradient-to-br from-green-600 to-green-700 rounded-2xl shadow-xl">
            <Calendar className="h-8 w-8 text-white" />
          </div>
          <div>
            <h1 className="text-4xl font-bold text-gray-900">Mis Vacaciones</h1>
            <p className="text-gray-500 mt-1">
              Bienvenido,{" "}
              <span className="font-semibold text-green-600">
                {user?.nombre}
              </span>
            </p>
          </div>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="h-10 w-10 text-green-600 animate-spin" />
          </div>
        ) : (
          <>
            {/* Card saldo */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-10">
              <div className="md:col-span-2 bg-white rounded-2xl shadow-xl border border-gray-200 p-6">
                <div className="flex items-center justify-between mb-6">
                  <div className="flex items-center gap-4">
                    <div className="p-3 bg-green-100 rounded-xl">
                      <Clock className="h-6 w-6 text-green-600" />
                    </div>
                    <div>
                      <h3 className="font-bold text-gray-900 text-xl">
                        Saldo Disponible
                      </h3>
                      <p className="text-sm text-gray-500">Días acumulados</p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="text-3xl font-bold text-green-600">
                      {horasADias(saldo?.horas_disponibles ?? 0)} días
                    </p>
                    <p className="text-xs text-gray-400">disponibles</p>
                  </div>
                </div>
                <div className="space-y-3">
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-600">
                      Usados: <b>{horasADias(saldo?.horas_usadas ?? 0)} días</b>
                    </span>
                    <span className="text-gray-600">
                      Total: <b>{horasADias(saldo?.horas_totales ?? 0)} días</b>
                    </span>
                  </div>
                  <div className="h-3 bg-gray-200 rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all ${porcentajeUsado > 80 ? "bg-red-500" : porcentajeUsado > 50 ? "bg-yellow-500" : "bg-green-500"}`}
                      style={{ width: `${porcentajeUsado}%` }}
                    />
                  </div>
                  <p className="text-xs text-gray-400 text-right">
                    {porcentajeUsado}% utilizado
                  </p>
                </div>
              </div>

              <div className="bg-gradient-to-br from-green-600 to-green-700 rounded-2xl shadow-xl p-6 flex flex-col items-center justify-center text-white">
                <div className="p-4 bg-white/20 rounded-2xl mb-4">
                  <Plus className="h-10 w-10" />
                </div>
                <p className="font-bold text-xl mb-1">Nueva Solicitud</p>
                <p className="text-green-200 text-sm text-center mb-6">
                  Solicita tus vacaciones
                </p>
                <button
                  onClick={() => setModalOpen(true)}
                  disabled={
                    parseFloat(saldo?.horas_disponibles || 0) <= 0 ||
                    tienePendiente
                  }
                  className="w-full py-3 bg-white text-green-700 rounded-xl font-semibold hover:bg-green-50 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Solicitar vacaciones
                </button>

                {tienePendiente && (
                  <p className="text-xs text-yellow-200 mt-3 text-center">
                    Tienes una solicitud en proceso
                  </p>
                )}
              </div>
            </div>

            {/* Historial */}
            <div className="bg-white rounded-2xl shadow-xl border border-gray-200 overflow-hidden">
              <div className="px-8 py-5 border-b border-gray-200 bg-gradient-to-r from-gray-50 to-white flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-gray-100 rounded-lg">
                    <FileText className="h-5 w-5 text-gray-600" />
                  </div>
                  <div>
                    <h3 className="font-bold text-gray-900 text-lg">
                      Mis Solicitudes
                    </h3>
                    <p className="text-sm text-gray-500">
                      Historial de vacaciones
                    </p>
                  </div>
                </div>
                <button
                  onClick={cargarDatos}
                  className="p-2 hover:bg-gray-100 rounded-xl transition-colors"
                >
                  <RefreshCw size={18} className="text-gray-500" />
                </button>
              </div>

              {vacaciones.length === 0 ? (
                <div className="p-16 text-center">
                  <div className="inline-flex p-6 bg-gray-100 rounded-2xl mb-4">
                    <Calendar className="h-12 w-12 text-gray-400" />
                  </div>
                  <p className="text-gray-500 font-medium text-lg">
                    No tienes solicitudes aún
                  </p>
                </div>
              ) : (
                <div className="divide-y divide-gray-100">
                  {vacaciones.map((v) => (
                    <div
                      key={v.id}
                      className="px-8 py-5 hover:bg-gray-50 transition-colors group"
                    >
                      <div className="flex items-center justify-between gap-4">
                        <div className="flex items-start gap-4 flex-1">
                          <div className="p-2.5 bg-gray-100 rounded-xl group-hover:bg-green-100 transition-colors">
                            <Calendar
                              size={18}
                              className="text-gray-600 group-hover:text-green-600"
                            />
                          </div>
                          <div className="flex-1">
                            <div className="flex items-center gap-2 mb-1">
                              <p className="font-semibold text-gray-900">
                                {v.tipo === "VACACION_PROGRAMADA"
                                  ? "Vacación Programada"
                                  : "Permiso con Cargo"}
                              </p>
                              {estadoBadge(v.estado)}
                            </div>
                            <p className="text-sm text-gray-500">
                              Solicitado el{" "}
                              {new Date(
                                v.fecha_solicitud + "T12:00:00",
                              ).toLocaleDateString("es-ES", {
                                day: "2-digit",
                                month: "long",
                                year: "numeric",
                              })}
                            </p>
                            <p className="text-sm text-gray-600 mt-1">
                              <span className="font-medium">Período:</span>{" "}
                              {new Date(
                                v.fecha_inicio + "T12:00:00",
                              ).toLocaleDateString("es-ES", {
                                day: "2-digit",
                                month: "short",
                              })}
                              {" → "}
                              {new Date(
                                v.fecha_fin + "T12:00:00",
                              ).toLocaleDateString("es-ES", {
                                day: "2-digit",
                                month: "short",
                                year: "numeric",
                              })}
                              {" · "}
                              <span className="font-semibold text-green-600">
                                {v.dias_solicitados} días
                              </span>
                            </p>
                            {v.observacion_jefe && v.estado === "NEGADO" && (
                              <p className="text-xs text-red-400 mt-1 flex items-center gap-1">
                                <AlertCircle size={10} /> {v.observacion_jefe}
                              </p>
                            )}
                          </div>
                        </div>
                        {!["APROBADO", "NEGADO"].includes(v.estado) && (
                          <button
                            onClick={() => handleCancelar(v)}
                            className="flex items-center gap-2 px-4 py-2 bg-red-50 text-red-600 hover:bg-red-100 rounded-xl transition-all flex-shrink-0"
                          >
                            <Trash2 size={16} />
                            <span className="text-sm font-medium hidden sm:inline">
                              Cancelar
                            </span>
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </>
        )}
      </div>

      {/* Modal */}
      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            onClick={() => setModalOpen(false)}
          />
          <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-lg mx-4 overflow-hidden">
            <div className="bg-gradient-to-r from-gray-900 to-gray-800 text-white px-8 py-6">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-4">
                  <div className="p-3 bg-white/10 rounded-xl">
                    <Calendar className="h-6 w-6" />
                  </div>
                  <div>
                    <h2 className="text-2xl font-bold">Nueva Solicitud</h2>
                    <p className="text-gray-300 text-sm mt-1">
                      Disponible:{" "}
                      <span className="font-semibold text-green-300">
                        {horasADias(saldo?.horas_disponibles)} días
                      </span>
                    </p>
                  </div>
                </div>
                <button
                  onClick={() => setModalOpen(false)}
                  className="p-2 hover:bg-white/10 rounded-xl transition-all"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>
            </div>

            <div className="p-8 space-y-5">
              {/* Tipo */}
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-2">
                  Tipo de solicitud <span className="text-red-500">*</span>
                </label>
                <div className="relative">
                  <select
                    value={form.tipo}
                    onChange={(e) =>
                      setForm((p) => ({ ...p, tipo: e.target.value }))
                    }
                    className="w-full border-2 border-gray-200 rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-green-500 appearance-none bg-white"
                  >
                    <option value="">Seleccione...</option>
                    <option value="VACACION_PROGRAMADA">
                      Vacación Programada
                    </option>
                    <option value="PERMISO_CON_CARGO">
                      Permiso con Cargo a Vacaciones
                    </option>
                  </select>
                  <ChevronDown className="absolute right-4 top-1/2 -translate-y-1/2 h-5 w-5 text-gray-400 pointer-events-none" />
                </div>
              </div>

              {/* Fechas */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-2">
                    Fecha inicio <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="date"
                    value={form.fecha_inicio}
                    onChange={(e) =>
                      setForm((p) => ({ ...p, fecha_inicio: e.target.value }))
                    }
                    className="w-full border-2 border-gray-200 rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-green-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-2">
                    Fecha fin <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="date"
                    value={form.fecha_fin}
                    min={form.fecha_inicio}
                    onChange={(e) =>
                      setForm((p) => ({ ...p, fecha_fin: e.target.value }))
                    }
                    className="w-full border-2 border-gray-200 rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-green-500"
                  />
                </div>
              </div>

              {/* Teléfonos */}
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1">
                  Contacto de emergencia institucional
                </label>
                <p className="text-xs text-gray-400 mb-3">
                  Indique los números donde se le pueda localizar en caso de
                  necesidad
                </p>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">
                      Teléfono domicilio
                    </label>
                    <input
                      type="tel"
                      value={form.telefono_domicilio}
                      onChange={(e) =>
                        setForm((p) => ({
                          ...p,
                          telefono_domicilio: e.target.value,
                        }))
                      }
                      placeholder="02-XXXXXXX"
                      className="w-full border-2 border-gray-200 rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-green-500"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">
                      Teléfono móvil <span className="text-red-500">*</span>
                    </label>
                    <input
                      type="tel"
                      value={form.telefono_movil}
                      onChange={(e) =>
                        setForm((p) => ({
                          ...p,
                          telefono_movil: e.target.value,
                        }))
                      }
                      placeholder="09XXXXXXXX"
                      maxLength={10}
                      required
                      className="w-full border-2 border-gray-200 rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-green-500"
                    />
                  </div>
                </div>
              </div>

              {/* Días calculados */}
              {form.dias_solicitados > 0 && (
                <div
                  className={`p-4 rounded-xl flex items-center gap-3 ${
                    parseFloat(form.dias_solicitados) >
                    parseFloat(saldo?.horas_disponibles || 0) / 8
                      ? "bg-red-50 border border-red-200"
                      : "bg-green-50 border border-green-200"
                  }`}
                >
                  <Calendar
                    size={20}
                    className={
                      parseFloat(form.dias_solicitados) >
                      parseFloat(saldo?.horas_disponibles || 0) / 8
                        ? "text-red-500"
                        : "text-green-500"
                    }
                  />
                  <div className="flex-1">
                    <p className="text-sm font-medium text-gray-700">
                      Días solicitados
                    </p>
                    <p
                      className={`text-lg font-bold ${
                        parseFloat(form.dias_solicitados) >
                        parseFloat(saldo?.horas_disponibles || 0) / 8
                          ? "text-red-600"
                          : "text-green-600"
                      }`}
                    >
                      {form.dias_solicitados} días
                    </p>
                  </div>
                  {parseFloat(form.dias_solicitados) >
                    parseFloat(saldo?.horas_disponibles || 0) / 8 && (
                    <div className="flex items-center gap-1">
                      <AlertCircle size={14} className="text-red-500" />
                      <span className="text-xs text-red-600 font-medium">
                        Supera el saldo
                      </span>
                    </div>
                  )}
                </div>
              )}
            </div>

            <div className="px-8 pb-8 flex gap-3">
              <button
                onClick={() => setModalOpen(false)}
                className="flex-1 px-4 py-3 border-2 border-gray-300 text-gray-700 hover:bg-gray-100 rounded-xl font-medium"
              >
                Cancelar
              </button>
              <button
                onClick={handleSubmit}
                disabled={
                  submitting ||
                  parseFloat(form.dias_solicitados) >
                    parseFloat(saldo?.horas_disponibles || 0) / 8
                }
                className="flex-1 px-4 py-3 bg-gradient-to-r from-green-600 to-green-700 text-white rounded-xl font-medium disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
              >
                {submitting ? (
                  <>
                    <Loader2 size={18} className="animate-spin" /> Enviando...
                  </>
                ) : (
                  <>
                    <Send size={18} /> Enviar solicitud
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

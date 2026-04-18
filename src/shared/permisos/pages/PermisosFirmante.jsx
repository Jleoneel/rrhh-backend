import { useEffect, useState } from "react";
import { useAuth } from "../../auth/AuthContext";
import {
  Clock,
  Calendar,
  CheckCircle2,
  XCircle,
  AlertCircle,
  Clock as ClockIcon,
  Plus,
  RefreshCw,
  Loader2,
  FileText,
  Send,
  Trash2,
  X,
} from "lucide-react";
import Swal from "sweetalert2";
import api from "../../../shared/api/axios";

const estadoBadge = (estado) => {
  const map = {
    PENDIENTE: "bg-yellow-100 text-yellow-800 border border-yellow-200",
    APROBADO: "bg-green-100 text-green-800 border border-green-200",
    RECHAZADO: "bg-red-100 text-red-800 border border-red-200",
  };
  const icons = {
    PENDIENTE: <ClockIcon size={12} />,
    APROBADO: <CheckCircle2 size={12} />,
    RECHAZADO: <XCircle size={12} />,
  };
  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ${map[estado]}`}
    >
      {icons[estado]} {estado}
    </span>
  );
};

const initialForm = {
  permiso_tipo_id: "",
  fecha: "",
  hora_salida: "",
  hora_regreso: "",
  motivo: "",
};

export default function PermisosFirmante() {
  const { user } = useAuth();
  const [saldo, setSaldo] = useState(null);
  const [permisos, setPermisos] = useState([]);
  const [tipos, setTipos] = useState([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [form, setForm] = useState(initialForm);
  const [submitting, setSubmitting] = useState(false);

  const cargarDatos = async () => {
    setLoading(true);
    try {
      const [saldoData, permisosData, tiposData] = await Promise.all([
        api.get("/permisos/mi-saldo-firmante").then((r) => r.data),
        api.get("/permisos/mis-permisos-firmante").then((r) => r.data),
        api.get("/permisos/tipos").then((r) => r.data),
      ]);
      setSaldo(saldoData);
      setPermisos(permisosData);
      setTipos(tiposData);
    } catch (err) {
      console.error(err);
      Swal.fire({
        toast: true,
        icon: "error",
        title: "Error",
        text: "No se pudieron cargar los datos",
        timer: 3000,
        showConfirmButton: false,
        position: "top-end",
        background: "#ffffff",
        color: "#1f2937",
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    cargarDatos();
  }, []);

  const horasCalculadas = () => {
    if (!form.hora_salida || !form.hora_regreso) return 0;
    const salida = new Date(`2000-01-01T${form.hora_salida}`);
    const regreso = new Date(`2000-01-01T${form.hora_regreso}`);
    const horas = (regreso - salida) / (1000 * 60 * 60);
    return horas > 0 ? horas.toFixed(2) : 0;
  };

  const handleSubmit = async () => {
    if (
      !form.permiso_tipo_id ||
      !form.fecha ||
      !form.hora_salida ||
      !form.hora_regreso
    ) {
      Swal.fire({
        toast: true,
        icon: "warning",
        title: "Campos incompletos",
        text: "Completa todos los campos obligatorios",
        timer: 2000,
        showConfirmButton: false,
        position: "top-end",
        background: "#ffffff",
        color: "#1f2937",
      });
      return;
    }
    if (horasCalculadas() <= 0) {
      Swal.fire({
        toast: true,
        icon: "error",
        title: "Horario inválido",
        text: "La hora de regreso debe ser posterior a la de salida",
        timer: 2000,
        showConfirmButton: false,
        position: "top-end",
        background: "#ffffff",
        color: "#1f2937",
      });
      return;
    }

    const tipoSeleccionado = tipos.find(
      (t) => t.id == form.permiso_tipo_id,
    )?.nombre;
    if (tipoSeleccionado === "Calamidad Doméstica" && !form.motivo.trim()) {
      Swal.fire({
        toast: true,
        icon: "warning",
        title: "Motivo requerido",
        text: "Para Calamidad Doméstica debes especificar el motivo",
        timer: 2500,
        showConfirmButton: false,
        position: "top-end",
      });
      return;
    }

    const confirm = await Swal.fire({
      title: "¿Enviar solicitud?",
      html: `
        <div class="text-left space-y-3 p-2">
          <div class="flex justify-between border-b pb-2">
            <span class="text-gray-600">Tipo de permiso:</span>
            <span class="font-semibold text-gray-900">${tipos.find((t) => t.id === parseInt(form.permiso_tipo_id))?.nombre || "-"}</span>
          </div>
          <div class="flex justify-between border-b pb-2">
            <span class="text-gray-600">Fecha:</span>
            <span class="font-semibold text-gray-900">${new Date(form.fecha).toLocaleDateString("es-ES", { day: "2-digit", month: "long", year: "numeric" })}</span>
          </div>
          <div class="flex justify-between border-b pb-2">
            <span class="text-gray-600">Horario:</span>
            <span class="font-semibold text-gray-900">${form.hora_salida} - ${form.hora_regreso}</span>
          </div>
          <div class="flex justify-between">
            <span class="text-gray-600">Duración:</span>
            <span class="font-semibold text-blue-600">${horasCalculadas()} horas</span>
          </div>
        </div>
      `,
      icon: "question",
      showCancelButton: true,
      confirmButtonText: "Sí, enviar solicitud",
      cancelButtonText: "Revisar",
      confirmButtonColor: "#3b82f6",
      cancelButtonColor: "#6b7280",
      background: "#ffffff",
      color: "#1f2937",
    });

    if (!confirm.isConfirmed) return;

    setSubmitting(true);
    try {
      await api.post("/permisos/solicitar-firmante", form);
      Swal.fire({
        toast: true,
        icon: "success",
        title: "¡Solicitud enviada!",
        text: "Tu solicitud ha sido registrada correctamente",
        timer: 2000,
        showConfirmButton: false,
        position: "top-end",
        background: "#ffffff",
        color: "#1f2937",
      });
      setModalOpen(false);
      setForm(initialForm);
      cargarDatos();
    } catch (err) {
      Swal.fire({
        icon: "error",
        title: "Error",
        text: err.response?.data?.message || "No se pudo enviar la solicitud",
        confirmButtonColor: "#ef4444",
        background: "#ffffff",
        color: "#1f2937",
      });
    } finally {
      setSubmitting(false);
    }
  };

  const handleCancelar = async (permiso) => {
    const confirm = await Swal.fire({
      title: "¿Cancelar solicitud?",
      text: "Esta acción no se puede deshacer",
      icon: "warning",
      showCancelButton: true,
      confirmButtonText: "Sí, cancelar",
      cancelButtonText: "No",
      confirmButtonColor: "#dc2626",
      cancelButtonColor: "#6b7280",
      background: "#ffffff",
      color: "#1f2937",
    });

    if (!confirm.isConfirmed) return;

    try {
      await api.put(`/permisos/${permiso.id}/cancelar-firmante`);
      Swal.fire({
        toast: true,
        icon: "success",
        title: "¡Cancelado!",
        text: "Solicitud cancelada correctamente",
        timer: 2000,
        showConfirmButton: false,
        position: "top-end",
        background: "#ffffff",
        color: "#1f2937",
      });
      cargarDatos();
    } catch (err) {
      Swal.fire({
        icon: "error",
        title: "Error",
        text: err.response?.data?.message || "No se pudo cancelar",
        confirmButtonColor: "#ef4444",
        background: "#ffffff",
        color: "#1f2937",
      });
    }
  };

  const horasADias = (horas) => (parseFloat(horas) / 8).toFixed(1);
  const porcentajeUsado = saldo
    ? Math.round((saldo.horas_usadas / saldo.horas_totales) * 100)
    : 0;

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-blue-50 p-8">
      <div className="max-w-5xl mx-auto">
        {/* Header */}
        <div className="mb-10">
          <div className="flex items-center gap-4 mb-3">
            <div className="p-4 bg-gradient-to-br from-blue-600 to-blue-700 rounded-2xl shadow-xl shadow-blue-200">
              <Clock className="h-8 w-8 text-white" />
            </div>
            <div>
              <h1 className="text-4xl font-bold text-gray-900 tracking-tight">
                Mis Permisos
              </h1>
              <div className="flex items-center gap-2 mt-2">
                <span className="text-gray-500">Bienvenido,</span>
                <span className="font-semibold text-blue-600 bg-blue-50 px-3 py-1 rounded-lg">
                  {user?.nombre}
                </span>
              </div>
            </div>
          </div>
        </div>

        {loading ? (
          <div className="flex flex-col items-center justify-center py-20">
            <Loader2 className="h-12 w-12 text-blue-600 animate-spin mb-4" />
            <p className="text-gray-500 font-medium">Cargando información...</p>
          </div>
        ) : (
          <>
            {/* Card de saldo */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-10">
              <div className="md:col-span-2 bg-white rounded-2xl shadow-xl border border-gray-200 p-6 hover:shadow-2xl transition-shadow duration-300">
                <div className="flex items-center justify-between mb-6">
                  <div className="flex items-center gap-4">
                    <div className="p-3 bg-gradient-to-br from-blue-100 to-blue-200 rounded-xl">
                      <Clock className="h-6 w-6 text-blue-600" />
                    </div>
                    <div>
                      <h3 className="font-bold text-gray-900 text-xl">
                        Saldo de Permisos {saldo?.anio}
                      </h3>
                      <p className="text-sm text-gray-500">
                        15 días hábiles anuales
                      </p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="text-3xl font-bold text-blue-600">
                      {horasADias(saldo?.horas_disponibles ?? 0)} días
                    </p>
                    <p className="text-xs text-gray-400">disponibles</p>
                  </div>
                </div>

                {/* Barra de progreso */}
                <div className="space-y-3">
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-600">
                      <span className="font-semibold text-gray-900">
                        {horasADias(saldo?.horas_usadas ?? 0)} días
                      </span>{" "}
                      usados
                    </span>
                    <span className="text-gray-600">
                      de{" "}
                      <span className="font-semibold text-gray-900">
                        {horasADias(saldo?.horas_totales ?? 0)} días
                      </span>
                    </span>
                  </div>
                  <div className="h-3 bg-gray-200 rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all duration-500 ${
                        porcentajeUsado > 80
                          ? "bg-gradient-to-r from-red-500 to-red-600"
                          : porcentajeUsado > 50
                            ? "bg-gradient-to-r from-yellow-500 to-yellow-600"
                            : "bg-gradient-to-r from-blue-500 to-blue-600"
                      }`}
                      style={{ width: `${porcentajeUsado}%` }}
                    />
                  </div>
                  <div className="flex justify-between text-xs">
                    <span className="text-gray-400">
                      {porcentajeUsado}% utilizado
                    </span>
                    {porcentajeUsado > 80 && (
                      <span className="text-red-500 flex items-center gap-1">
                        <AlertCircle size={12} /> Saldo bajo
                      </span>
                    )}
                  </div>
                </div>
              </div>

              {/* Botón nueva solicitud */}
              <div className="bg-gradient-to-br from-blue-600 to-blue-700 rounded-2xl shadow-xl p-6 flex flex-col items-center justify-center text-white hover:shadow-2xl transition-all duration-300">
                <div className="p-4 bg-white/20 rounded-2xl mb-4">
                  <Plus className="h-10 w-10" />
                </div>
                <p className="font-bold text-xl mb-1">Nueva Solicitud</p>
                <p className="text-blue-200 text-sm text-center mb-6">
                  Solicita un permiso de ausencia temporal
                </p>
                <button
                  onClick={() => setModalOpen(true)}
                  disabled={!saldo || parseFloat(saldo.horas_disponibles) <= 0}
                  className="w-full py-3 bg-white text-blue-700 rounded-xl font-semibold hover:bg-blue-50 transition-all disabled:opacity-50 disabled:cursor-not-allowed shadow-lg"
                >
                  Solicitar permiso
                </button>
                {parseFloat(saldo?.horas_disponibles) <= 0 && (
                  <p className="text-xs text-red-200 mt-3 text-center">
                    Sin saldo disponible
                  </p>
                )}
              </div>
            </div>

            {/* Historial de permisos */}
            <div className="bg-white rounded-2xl shadow-xl border border-gray-200 overflow-hidden">
              <div className="px-8 py-5 border-b border-gray-200 bg-gradient-to-r from-gray-50 to-white">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="p-2 bg-gray-100 rounded-lg">
                      <FileText className="h-5 w-5 text-gray-600" />
                    </div>
                    <div>
                      <h3 className="font-bold text-gray-900 text-lg">
                        Mis Solicitudes
                      </h3>
                      <p className="text-sm text-gray-500">
                        Historial de permisos solicitados
                      </p>
                    </div>
                  </div>
                  <button
                    onClick={cargarDatos}
                    className="p-2 hover:bg-gray-100 rounded-xl transition-colors"
                    title="Actualizar"
                  >
                    <RefreshCw size={18} className="text-gray-500" />
                  </button>
                </div>
              </div>

              {permisos.length === 0 ? (
                <div className="p-16 text-center">
                  <div className="inline-flex p-6 bg-gray-100 rounded-2xl mb-4">
                    <FileText className="h-12 w-12 text-gray-400" />
                  </div>
                  <p className="text-gray-500 font-medium text-lg">
                    No tienes solicitudes aún
                  </p>
                  <p className="text-sm text-gray-400 mt-1">
                    Tus permisos solicitados aparecerán aquí
                  </p>
                </div>
              ) : (
                <div className="divide-y divide-gray-100">
                  {permisos.map((p) => (
                    <div
                      key={p.id}
                      className="px-8 py-5 hover:bg-gray-50 transition-colors group"
                    >
                      <div className="flex items-center justify-between gap-4">
                        <div className="flex items-start gap-4 flex-1">
                          <div className="p-2.5 bg-gray-100 rounded-xl group-hover:bg-blue-100 transition-colors">
                            <Calendar
                              size={18}
                              className="text-gray-600 group-hover:text-blue-600"
                            />
                          </div>
                          <div className="flex-1">
                            <div className="flex items-center gap-2 mb-1">
                              <p className="font-semibold text-gray-900">
                                {p.tipo_permiso}
                              </p>
                              {estadoBadge(p.estado)}
                            </div>
                            <p className="text-sm text-gray-500">
                              {new Date(p.fecha).toLocaleDateString("es-ES", {
                                day: "2-digit",
                                month: "long",
                                year: "numeric",
                              })}
                              {" · "}
                              <span className="font-mono text-gray-600">
                                {p.hora_salida} - {p.hora_regreso}
                              </span>
                              {" · "}
                              <span className="font-semibold text-blue-600">
                                {p.horas_solicitadas}h
                              </span>
                            </p>
                            {p.motivo && (
                              <p className="text-xs text-gray-400 mt-1 max-w-md">
                                {p.motivo}
                              </p>
                            )}
                            {p.observacion_jefe && p.estado !== "APROBADO" && (
                              <p className="text-xs text-red-400 mt-1 flex items-center gap-1">
                                <AlertCircle size={10} />
                                {p.observacion_jefe}
                              </p>
                            )}
                          </div>
                        </div>

                        {/* Botón cancelar - AL FINAL DE LA FILA */}
                        {p.estado === "PENDIENTE" && (
                          <button
                            onClick={() => handleCancelar(p)}
                            className="flex items-center gap-2 px-4 py-2 bg-red-50 text-red-600 hover:bg-red-100 rounded-xl transition-all duration-200 flex-shrink-0"
                            title="Cancelar solicitud"
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

      {/* Modal Nueva Solicitud */}
      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            onClick={() => setModalOpen(false)}
          />
          <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-lg mx-4 overflow-hidden animate-in fade-in zoom-in duration-200">
            {/* Header */}
            <div className="bg-gradient-to-r from-gray-900 to-gray-800 text-white px-8 py-6">
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-4">
                  <div className="p-3 bg-white/10 rounded-xl">
                    <Calendar className="h-6 w-6" />
                  </div>
                  <div>
                    <h2 className="text-2xl font-bold">Nueva Solicitud</h2>
                    <p className="text-gray-300 text-sm mt-1">
                      Disponible:{" "}
                      <span className="font-semibold text-blue-300">
                        {horasADias(saldo?.horas_disponibles)} días
                      </span>
                    </p>
                  </div>
                </div>
                <button
                  onClick={() => setModalOpen(false)}
                  className="p-2 hover:bg-white/10 rounded-xl transition-all hover:rotate-90"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>
            </div>

            {/* Content */}
            <div className="p-8 max-h-[60vh] overflow-y-auto">
              <div className="space-y-6">
                {/* Tipo de permiso */}
                <div className="space-y-2">
                  <label className="block text-sm font-semibold text-gray-700">
                    Tipo de permiso <span className="text-red-500">*</span>
                  </label>
                  <div className="relative">
                    <select
                      value={form.permiso_tipo_id}
                      onChange={(e) =>
                        setForm((p) => ({
                          ...p,
                          permiso_tipo_id: e.target.value,
                        }))
                      }
                      className="w-full border-2 border-gray-200 rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent appearance-none cursor-pointer bg-white"
                    >
                      <option value="">Seleccione el tipo...</option>
                      {tipos.map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.nombre}
                        </option>
                      ))}
                    </select>
                    <svg
                      className="absolute right-3 top-1/2 -translate-y-1/2 h-5 w-5 text-gray-400 pointer-events-none"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M19 9l-7 7-7-7"
                      />
                    </svg>
                  </div>
                </div>

                {/* Fecha */}
                <div className="space-y-2">
                  <label className="block text-sm font-semibold text-gray-700">
                    Fecha del permiso <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="date"
                    value={form.fecha}
                    onChange={(e) =>
                      setForm((p) => ({ ...p, fecha: e.target.value }))
                    }
                    min={new Date().toISOString().split("T")[0]}
                    className="w-full border-2 border-gray-200 rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  />
                </div>

                {/* Horas */}
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <label className="block text-sm font-semibold text-gray-700">
                      Hora salida <span className="text-red-500">*</span>
                    </label>
                    <input
                      type="time"
                      value={form.hora_salida}
                      onChange={(e) =>
                        setForm((p) => ({ ...p, hora_salida: e.target.value }))
                      }
                      className="w-full border-2 border-gray-200 rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="block text-sm font-semibold text-gray-700">
                      Hora regreso <span className="text-red-500">*</span>
                    </label>
                    <input
                      type="time"
                      value={form.hora_regreso}
                      onChange={(e) =>
                        setForm((p) => ({ ...p, hora_regreso: e.target.value }))
                      }
                      className="w-full border-2 border-gray-200 rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    />
                  </div>
                </div>

                {/* Horas calculadas */}
                {horasCalculadas() > 0 && (
                  <div
                    className={`p-4 rounded-xl flex items-center gap-3 ${
                      horasCalculadas() > parseFloat(saldo?.horas_disponibles)
                        ? "bg-red-50 border border-red-200"
                        : "bg-blue-50 border border-blue-200"
                    }`}
                  >
                    <Clock
                      size={20}
                      className={
                        horasCalculadas() > parseFloat(saldo?.horas_disponibles)
                          ? "text-red-500"
                          : "text-blue-500"
                      }
                    />
                    <div className="flex-1">
                      <p className="text-sm font-medium text-gray-700">
                        Duración del permiso
                      </p>
                      <p
                        className={`text-lg font-bold ${
                          horasCalculadas() >
                          parseFloat(saldo?.horas_disponibles)
                            ? "text-red-600"
                            : "text-blue-600"
                        }`}
                      >
                        {horasCalculadas()} horas
                      </p>
                    </div>
                    {horasCalculadas() >
                      parseFloat(saldo?.horas_disponibles) && (
                      <div className="flex items-center gap-1">
                        <AlertCircle size={14} className="text-red-500" />
                        <span className="text-xs text-red-600 font-medium">
                          Supera el saldo disponible
                        </span>
                      </div>
                    )}
                  </div>
                )}

                {/* Motivo */}
                <div className="space-y-2">
                  <label className="block text-sm font-semibold text-gray-700">
                    Motivo{" "}
                    {tipos.find((t) => t.id == form.permiso_tipo_id)?.nombre ===
                    "Calamidad Doméstica" ? (
                      <span className="text-red-500">*</span>
                    ) : (
                      <span className="text-gray-400 text-xs">(opcional)</span>
                    )}
                  </label>

                  <textarea
                    value={form.motivo}
                    onChange={(e) =>
                      setForm((p) => ({ ...p, motivo: e.target.value }))
                    }
                    rows={3}
                    className="w-full border-2 border-gray-200 rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-none"
                    placeholder="Describa brevemente el motivo del permiso..."
                  />
                </div>
              </div>
            </div>

            {/* Footer */}
            <div className="sticky bottom-0 bg-gradient-to-r from-gray-50 to-gray-100 border-t border-gray-200 px-8 py-5">
              <div className="flex gap-3">
                <button
                  onClick={() => setModalOpen(false)}
                  className="flex-1 px-4 py-3 border-2 border-gray-300 text-gray-700 hover:bg-gray-100 rounded-xl font-medium transition-all"
                >
                  Cancelar
                </button>
                <button
                  onClick={handleSubmit}
                  disabled={
                    submitting ||
                    horasCalculadas() >
                      parseFloat(saldo?.horas_disponibles ?? 0)
                  }
                  className="flex-1 px-4 py-3 bg-gradient-to-r from-blue-600 to-blue-700 text-white rounded-xl font-medium transition-all shadow-lg hover:shadow-xl disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                >
                  {submitting ? (
                    <>
                      <Loader2 size={18} className="animate-spin" />
                      Enviando...
                    </>
                  ) : (
                    <>
                      <Send size={18} />
                      Enviar solicitud
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

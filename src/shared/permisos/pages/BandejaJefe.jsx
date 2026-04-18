import { useEffect, useState, useMemo } from "react";
import { useAuth } from "../../auth/AuthContext";
import {
  CheckCircle,
  XCircle,
  Clock,
  RefreshCw,
  Loader2,
  User,
  Calendar,
  FileText,
  Filter,
  ChevronDown,
  CheckSquare,
  AlertCircle,
  TrendingUp,
  Users,
  Send,
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
    PENDIENTE: <Clock size={12} />,
    APROBADO: <CheckCircle size={12} />,
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

// eslint-disable-next-line no-unused-vars
const StatCard = ({ label, value, icon: Icon, color = "blue", onClick }) => {
  const colors = {
    blue: "from-blue-500 to-blue-600",
    green: "from-green-500 to-green-600",
    red: "from-red-500 to-red-600",
    yellow: "from-yellow-500 to-yellow-600",
  };

  return (
    <div
      onClick={onClick}
      className="bg-white rounded-2xl p-6 shadow-lg border border-gray-100 hover:shadow-xl transition-all duration-300 group cursor-pointer"
    >
      <div className="flex items-start justify-between">
        <div>
          <p className="text-gray-500 text-sm font-medium mb-1">{label}</p>
          <p className="text-3xl font-bold text-gray-900">{value}</p>
        </div>
        <div
          className={`p-3 bg-gradient-to-br ${colors[color]} rounded-xl shadow-lg group-hover:scale-110 transition-transform duration-300`}
        >
          <Icon className="h-5 w-5 text-white" />
        </div>
      </div>
    </div>
  );
};

export default function BandejaJefe() {
  const { user } = useAuth();
  const [permisos, setPermisos] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filtroEstado, setFiltroEstado] = useState("PENDIENTE");
  const [modalOpen, setModalOpen] = useState(false);
  const [selected, setSelected] = useState(null);
  const [observacion, setObservacion] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const cargarPermisos = async () => {
    setLoading(true);
    try {
      const { data } = await api.get("/permisos/bandeja");
      setPermisos(data);
    } catch (err) {
      console.error(err);
      Swal.fire({
        toast: true,
        icon: "error",
        title: "Error",
        text: "No se pudieron cargar las solicitudes",
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
    cargarPermisos();
  }, []);

  const permisosFiltrados = useMemo(() => {
    if (filtroEstado === "TODOS") return permisos;
    return permisos.filter((p) => p.estado === filtroEstado);
  }, [permisos, filtroEstado]);

  const stats = useMemo(
    () => ({
      pendientes: permisos.filter((p) => p.estado === "PENDIENTE").length,
      aprobados: permisos.filter((p) => p.estado === "APROBADO").length,
      rechazados: permisos.filter((p) => p.estado === "RECHAZADO").length,
      total: permisos.length,
    }),
    [permisos],
  );

  const abrirModal = (permiso, accion) => {
    setSelected({ ...permiso, accion });
    setObservacion("");
    setModalOpen(true);
  };

  const handleResponder = async () => {
    if (!selected) return;

    if (selected.accion === "RECHAZADO" && !observacion) {
      Swal.fire({
        toast: true,
        icon: "warning",
        title: "Observación requerida",
        text: "Debes indicar el motivo del rechazo",
        timer: 2000,
        showConfirmButton: false,
        position: "top-end",
        background: "#ffffff",
        color: "#1f2937",
      });
      return;
    }

    const confirm = await Swal.fire({
      title:
        selected.accion === "APROBADO"
          ? "¿Aprobar permiso?"
          : "¿Rechazar permiso?",
      html: `
        <div class="text-left space-y-3 p-2">
          <div class="flex justify-between border-b pb-2">
            <span class="text-gray-600">Servidor:</span>
            <span class="font-semibold text-gray-900">${selected.servidor_nombre}</span>
          </div>
          <div class="flex justify-between border-b pb-2">
            <span class="text-gray-600">Fecha:</span>
            <span class="font-semibold text-gray-900">${new Date(selected.fecha).toLocaleDateString("es-ES", { day: "2-digit", month: "long", year: "numeric" })}</span>
          </div>
          <div class="flex justify-between border-b pb-2">
            <span class="text-gray-600">Horario:</span>
            <span class="font-semibold text-gray-900">${selected.hora_salida} - ${selected.hora_regreso}</span>
          </div>
          <div class="flex justify-between">
            <span class="text-gray-600">Horas:</span>
            <span class="font-semibold text-blue-600">${selected.horas_solicitadas}h</span>
          </div>
          ${
            observacion
              ? `
          <div class="mt-3 p-3 bg-gray-50 rounded-lg">
            <p class="text-xs text-gray-500 mb-1">Observación:</p>
            <p class="text-sm text-gray-700">${observacion}</p>
          </div>
          `
              : ""
          }
        </div>
      `,
      icon: selected.accion === "APROBADO" ? "question" : "warning",
      showCancelButton: true,
      confirmButtonText:
        selected.accion === "APROBADO" ? "Sí, aprobar" : "Sí, rechazar",
      cancelButtonText: "Cancelar",
      confirmButtonColor:
        selected.accion === "APROBADO" ? "#10b981" : "#ef4444",
      cancelButtonColor: "#6b7280",
      background: "#ffffff",
      color: "#1f2937",
    });

    if (!confirm.isConfirmed) return;

    setSubmitting(true);
    try {
      await api.put(`/permisos/${selected.id}/responder`, {
        estado: selected.accion,
        observacion,
      });

      Swal.fire({
        toast: true,
        icon: "success",
        title: "¡Procesado!",
        text: `Permiso ${selected.accion === "APROBADO" ? "aprobado" : "rechazado"} correctamente`,
        timer: 2000,
        showConfirmButton: false,
        position: "top-end",
        background: "#ffffff",
        color: "#1f2937",
      });

      setModalOpen(false);
      cargarPermisos();
    } catch (err) {
      Swal.fire({
        icon: "error",
        title: "Error",
        text: err.response?.data?.message || "No se pudo procesar la solicitud",
        confirmButtonColor: "#ef4444",
        background: "#ffffff",
        color: "#1f2937",
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-blue-50 p-8">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="mb-10">
          <div className="flex items-center justify-between mb-6">
            <div className="flex items-center gap-4">
              <div className="p-4 bg-gradient-to-br from-blue-600 to-blue-700 rounded-2xl shadow-xl shadow-blue-200">
                <Users className="h-8 w-8 text-white" />
              </div>
              <div>
                <h1 className="text-4xl font-bold text-gray-900 tracking-tight">
                  Bandeja de Permisos
                </h1>
                <div className="flex items-center gap-2 mt-2">
                  <span className="text-gray-500">Jefe de área:</span>
                  <span className="font-semibold text-blue-600 bg-blue-50 px-3 py-1 rounded-lg">
                    {user?.nombre}
                  </span>
                </div>
              </div>
            </div>
            <button
              onClick={cargarPermisos}
              className="p-3 bg-white hover:bg-gray-50 rounded-xl transition-all shadow-md hover:shadow-lg"
              title="Actualizar datos"
            >
              <RefreshCw size={18} className="text-gray-500" />
            </button>
          </div>

          {/* Stats Cards */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
            <StatCard
              label="Pendientes"
              value={stats.pendientes}
              icon={Clock}
              color="yellow"
              onClick={() => setFiltroEstado("PENDIENTE")}
            />
            <StatCard
              label="Aprobados"
              value={stats.aprobados}
              icon={CheckCircle}
              color="green"
              onClick={() => setFiltroEstado("APROBADO")}
            />
            <StatCard
              label="Rechazados"
              value={stats.rechazados}
              icon={XCircle}
              color="red"
              onClick={() => setFiltroEstado("RECHAZADO")}
            />
            <StatCard
              label="Total"
              value={stats.total}
              icon={TrendingUp}
              color="blue"
              onClick={() => setFiltroEstado("TODOS")}
            />
          </div>
        </div>

        {/* Filtros */}
        <div className="flex items-center justify-between mb-6">
          <div className="relative">
            <Filter className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
            <select
              value={filtroEstado}
              onChange={(e) => setFiltroEstado(e.target.value)}
              className="border-2 border-gray-200 rounded-xl pl-10 pr-10 py-3 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent appearance-none bg-white cursor-pointer min-w-[180px]"
            >
              <option value="TODOS">Todos los estados</option>
              <option value="PENDIENTE">Pendientes</option>
              <option value="APROBADO">Aprobados</option>
              <option value="RECHAZADO">Rechazados</option>
            </select>
            <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400 pointer-events-none" />
          </div>
          <div className="flex items-center gap-2">
            <div className="h-2 w-2 rounded-full bg-blue-500 animate-pulse" />
            <span className="text-sm text-gray-500">
              {permisosFiltrados.length} solicitud
              {permisosFiltrados.length !== 1 ? "es" : ""}
            </span>
          </div>
        </div>

        {/* Lista de permisos */}
        <div className="bg-white rounded-2xl shadow-xl border border-gray-200 overflow-hidden">
          {loading ? (
            <div className="flex flex-col items-center justify-center py-20">
              <Loader2 className="h-12 w-12 text-blue-600 animate-spin mb-4" />
              <p className="text-gray-500 font-medium">
                Cargando solicitudes...
              </p>
            </div>
          ) : permisosFiltrados.length === 0 ? (
            <div className="p-20 text-center">
              <div className="inline-flex p-6 bg-gray-100 rounded-2xl mb-4">
                <CheckSquare className="h-12 w-12 text-gray-400" />
              </div>
              <p className="text-gray-500 font-medium text-lg">
                No hay solicitudes{" "}
                {filtroEstado !== "TODOS"
                  ? filtroEstado.toLowerCase() + "s"
                  : ""}
              </p>
              <p className="text-sm text-gray-400 mt-1">
                {filtroEstado === "PENDIENTE"
                  ? "No hay solicitudes pendientes de revisión"
                  : "Las solicitudes aparecerán aquí cuando sean procesadas"}
              </p>
            </div>
          ) : (
            <div className="divide-y divide-gray-100">
              {permisosFiltrados.map((p) => (
                <div
                  key={p.id}
                  className="p-6 hover:bg-gradient-to-r hover:from-blue-50/50 hover:to-transparent transition-all duration-300 group"
                >
                  <div className="flex items-start justify-between gap-6">
                    <div className="flex items-start gap-5 flex-1 min-w-0">
                      <div className="p-3 bg-gradient-to-br from-blue-100 to-blue-200 rounded-xl flex-shrink-0 group-hover:scale-110 transition-transform">
                        <User className="h-5 w-5 text-blue-600" />
                      </div>

                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-3 flex-wrap mb-2">
                          <p className="font-bold text-gray-900 text-lg">
                            {p.servidor_nombre}
                          </p>
                          <span className="text-xs text-gray-400 font-mono bg-gray-100 px-2 py-0.5 rounded-lg">
                            {p.cedula}
                          </span>
                          {estadoBadge(p.estado)}
                        </div>

                        <div className="text-sm text-gray-500 mb-3 flex items-center gap-1">
                          <div className="w-1.5 h-1.5 rounded-full bg-gray-300" />
                          {p.unidad_organica}
                        </div>

                        <div className="flex flex-wrap items-center gap-5">
                          <div className="flex items-center gap-2 text-sm text-gray-600">
                            <Calendar size={14} className="text-gray-400" />
                            <span>
                              {new Date(p.fecha).toLocaleDateString("es-ES", {
                                day: "2-digit",
                                month: "long",
                                year: "numeric",
                              })}
                            </span>
                          </div>
                          <div className="flex items-center gap-2 text-sm text-gray-600">
                            <Clock size={14} className="text-gray-400" />
                            <span className="font-mono">
                              {p.hora_salida} - {p.hora_regreso}
                            </span>
                            <span className="font-semibold text-blue-600 ml-1">
                              {p.horas_solicitadas}h
                            </span>
                          </div>
                          <div className="flex items-center gap-2 text-sm text-gray-600">
                            <FileText size={14} className="text-gray-400" />
                            <span>{p.tipo_permiso}</span>
                          </div>
                        </div>

                        {p.motivo && (
                          <div className="mt-3 p-3 bg-gray-50 rounded-xl border border-gray-100">
                            <p className="text-xs text-gray-400 mb-1">
                              Motivo:
                            </p>
                            <p className="text-sm text-gray-700">
                              "{p.motivo}"
                            </p>
                          </div>
                        )}

                        {p.observacion_jefe && (
                          <div className="mt-3 p-3 bg-amber-50 rounded-xl border border-amber-200">
                            <p className="text-xs text-amber-600 mb-1 flex items-center gap-1">
                              <AlertCircle size={10} /> Tu observación:
                            </p>
                            <p className="text-sm text-amber-800">
                              {p.observacion_jefe}
                            </p>
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Acciones solo para PENDIENTE */}
                    {p.estado === "PENDIENTE" && (
                      <div className="flex items-center gap-3 flex-shrink-0">
                        <button
                          onClick={() => abrirModal(p, "APROBADO")}
                          className="flex items-center gap-2 px-5 py-2.5 bg-gradient-to-r from-green-600 to-green-700 text-white rounded-xl hover:from-green-700 hover:to-green-800 transition-all shadow-md hover:shadow-lg text-sm font-medium"
                        >
                          <CheckCircle size={16} />
                          Aprobar
                        </button>
                        <button
                          onClick={() => abrirModal(p, "RECHAZADO")}
                          className="flex items-center gap-2 px-5 py-2.5 bg-red-50 text-red-600 border border-red-200 rounded-xl hover:bg-red-100 transition-all text-sm font-medium"
                        >
                          <XCircle size={16} />
                          Rechazar
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Modal de confirmación - MEJORADO */}
      {modalOpen && selected && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            onClick={() => setModalOpen(false)}
          />
          <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-md mx-4 overflow-hidden animate-in fade-in zoom-in duration-200">
            {/* Header */}
            <div
              className={`px-6 py-5 ${
                selected.accion === "APROBADO"
                  ? "bg-gradient-to-r from-green-900 to-green-800"
                  : "bg-gradient-to-r from-red-900 to-red-800"
              } text-white`}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-white/10 rounded-lg">
                    {selected.accion === "APROBADO" ? (
                      <CheckCircle className="h-5 w-5" />
                    ) : (
                      <XCircle className="h-5 w-5" />
                    )}
                  </div>
                  <div>
                    <h2 className="text-xl font-bold">
                      {selected.accion === "APROBADO"
                        ? "Aprobar permiso"
                        : "Rechazar permiso"}
                    </h2>
                    <p className="text-sm opacity-90 mt-0.5">
                      {selected.servidor_nombre}
                    </p>
                  </div>
                </div>
                <button
                  onClick={() => setModalOpen(false)}
                  className="p-2 hover:bg-white/10 rounded-lg transition-all hover:rotate-90"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>
            </div>

            {/* Content */}
            <div className="p-6">
              {/* Resumen */}
              <div className="bg-gradient-to-r from-gray-50 to-white rounded-xl p-4 mb-6 space-y-3 border border-gray-200">
                <div className="flex justify-between text-sm">
                  <span className="text-gray-500">Tipo de permiso:</span>
                  <span className="font-semibold text-gray-900">
                    {selected.tipo_permiso}
                  </span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-gray-500">Fecha:</span>
                  <span className="font-semibold text-gray-900">
                    {new Date(selected.fecha).toLocaleDateString("es-ES", {
                      day: "2-digit",
                      month: "long",
                      year: "numeric",
                    })}
                  </span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-gray-500">Horario:</span>
                  <span className="font-semibold text-gray-900 font-mono">
                    {selected.hora_salida} - {selected.hora_regreso}
                  </span>
                </div>
                <div className="flex justify-between text-sm pt-2 border-t border-gray-200">
                  <span className="text-gray-500">Horas solicitadas:</span>
                  <span className="font-bold text-blue-600 text-lg">
                    {selected.horas_solicitadas}h
                  </span>
                </div>
              </div>

              {/* Observación */}
              <div className="mb-6">
                <label className="block text-sm font-semibold text-gray-700 mb-2">
                  Observación{" "}
                  {selected.accion === "RECHAZADO" && (
                    <span className="text-red-500">*</span>
                  )}
                </label>
                <textarea
                  value={observacion}
                  onChange={(e) => setObservacion(e.target.value)}
                  rows={4}
                  className="w-full border-2 border-gray-200 rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-none transition-all"
                  placeholder={
                    selected.accion === "RECHAZADO"
                      ? "Indique el motivo del rechazo..."
                      : "Observación opcional (se notificará al servidor)..."
                  }
                />
                {selected.accion === "RECHAZADO" && !observacion && (
                  <p className="text-xs text-red-500 mt-2 flex items-center gap-1">
                    <AlertCircle size={12} />
                    La observación es requerida al rechazar el permiso
                  </p>
                )}
              </div>
            </div>

            {/* Footer */}
            <div className="bg-gradient-to-r from-gray-50 to-gray-100 border-t border-gray-200 px-6 py-5">
              <div className="flex gap-3">
                <button
                  onClick={() => setModalOpen(false)}
                  className="flex-1 px-4 py-3 border-2 border-gray-300 text-gray-700 rounded-xl font-medium hover:bg-gray-100 transition-all"
                >
                  Cancelar
                </button>
                <button
                  onClick={handleResponder}
                  disabled={
                    submitting ||
                    (selected.accion === "RECHAZADO" && !observacion)
                  }
                  className={`flex-1 px-4 py-3 text-white rounded-xl font-medium transition-all shadow-lg hover:shadow-xl disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 ${
                    selected.accion === "APROBADO"
                      ? "bg-gradient-to-r from-green-600 to-green-700 hover:from-green-700 hover:to-green-800"
                      : "bg-gradient-to-r from-red-600 to-red-700 hover:from-red-700 hover:to-red-800"
                  }`}
                >
                  {submitting ? (
                    <>
                      <Loader2 size={16} className="animate-spin" />
                      Procesando...
                    </>
                  ) : selected.accion === "APROBADO" ? (
                    <>
                      <CheckCircle size={16} />
                      Confirmar aprobación
                    </>
                  ) : (
                    <>
                      <XCircle size={16} />
                      Confirmar rechazo
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

import { useEffect, useState, useMemo } from "react";
import {
  Calendar,
  RefreshCw,
  Loader2,
  FileText,
  Search,
  Filter,
  ChevronDown,
  Download,
  CheckCircle,
  XCircle,
  Clock,
  Users,
  TrendingUp,
  Building2,
  User,
  Umbrella,
} from "lucide-react";
import api from "../../../shared/api/axios";
import Swal from "sweetalert2";

const ESTADOS = [
  "TODOS",
  "PENDIENTE_JEFE",
  "PENDIENTE_GERENTE",
  "PENDIENTE_UATH",
  "APROBADO",
  "NEGADO",
];

const estadoLabel = {
  PENDIENTE_JEFE: "Pend. Jefe",
  PENDIENTE_GERENTE: "Pend. Jefe Superior",
  PENDIENTE_UATH: "Pend. UATH",
  APROBADO: "Aprobado",
  NEGADO: "Negado",
};

const estadoBadge = (estado) => {
  const map = {
    PENDIENTE_JEFE: "bg-yellow-100 text-yellow-800 border border-yellow-200",
    PENDIENTE_GERENTE: "bg-orange-100 text-orange-800 border border-orange-200",
    PENDIENTE_UATH: "bg-blue-100 text-blue-800 border border-blue-200",
    APROBADO: "bg-green-100 text-green-800 border border-green-200",
    NEGADO: "bg-red-100 text-red-800 border border-red-200",
  };
  const icons = {
    PENDIENTE_JEFE: <Clock size={11} />,
    PENDIENTE_GERENTE: <Clock size={11} />,
    PENDIENTE_UATH: <Clock size={11} />,
    APROBADO: <CheckCircle size={11} />,
    NEGADO: <XCircle size={11} />,
  };
  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ${map[estado] || "bg-gray-100 text-gray-600"}`}
    >
      {icons[estado]} {estadoLabel[estado] || estado}
    </span>
  );
};

// eslint-disable-next-line no-unused-vars
const StatCard = ({ label, value, icon: Icon, color = "blue" }) => {
  const colors = {
    blue: "from-blue-500 to-blue-600",
    green: "from-green-500 to-green-600",
    yellow: "from-yellow-500 to-yellow-600",
    red: "from-red-500 to-red-600",
    purple: "from-purple-500 to-purple-600",
  };

  return (
    <div className="bg-white rounded-2xl p-6 shadow-lg border border-gray-100 hover:shadow-xl transition-all duration-300 group">
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

export default function ReporteVacaciones() {
  const [fecha, setFecha] = useState("");
  const [estado, setEstado] = useState("TODOS");
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");

  const cargarReporte = async (f = fecha, e = estado) => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (f) params.append("fecha", f);
      if (e !== "TODOS") params.append("estado", e);
      const res = await api.get(`/permisos/reporte-vacaciones?${params}`);
      setData(res.data.data);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    cargarReporte(fecha, estado);
  }, [fecha, estado]);

  const handleFecha = (e) => {
    setFecha(e.target.value);
    cargarReporte(e.target.value, estado);
  };

  const handleEstado = (e) => {
    setEstado(e.target.value);
    cargarReporte(fecha, e.target.value);
  };

  const filtrados = useMemo(() => {
    if (!search) return data;
    return data.filter((v) =>
      `${v.servidor_nombre} ${v.cedula} ${v.unidad_organica}`
        .toLowerCase()
        .includes(search.toLowerCase()),
    );
  }, [data, search]);

  const stats = useMemo(
    () => ({
      total: filtrados.length,
      aprobados: filtrados.filter((v) => v.estado === "APROBADO").length,
      pendientes: filtrados.filter((v) => v.estado.startsWith("PENDIENTE"))
        .length,
      negados: filtrados.filter((v) => v.estado === "NEGADO").length,
      totalDias: filtrados.reduce(
        (acc, v) => acc + (v.dias_solicitados || 0),
        0,
      ),
    }),
    [filtrados],
  );

  const handleDescargarPdf = async (v) => {
    try {
      const token = localStorage.getItem("token");

      // Si está aprobado, descargar el PDF final firmado por UATH
      const url =
        v.estado === "APROBADO" && v.archivo_uath
          ? `${import.meta.env.VITE_API_URL}/api/permisos/${v.id}/descargar-vacacion/uath`
          : `${import.meta.env.VITE_API_URL}/api/permisos/${v.id}/pdf-vacacion`;

      const response = await fetch(url, {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (!response.ok) throw new Error("Error generando PDF");

      const blob = await response.blob();
      const a = document.createElement("a");
      a.href = window.URL.createObjectURL(blob);
      a.download = `vacacion_${v.servidor_nombre}_${v.id}.pdf`;
      document.body.appendChild(a);
      a.click();
      setTimeout(() => {
        document.body.removeChild(a);
        window.URL.revokeObjectURL(a.href);
      }, 100);

      Swal.fire({
        toast: true,
        icon: "success",
        text: "PDF descargado correctamente",
        timer: 2000,
        showConfirmButton: false,
        position: "top-end",
      });
      // eslint-disable-next-line no-unused-vars
    } catch (err) {
      Swal.fire({
        icon: "error",
        title: "Error",
        text: "No se pudo descargar el PDF",
        confirmButtonColor: "#ef4444",
      });
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-green-50 p-8">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="mb-10">
          <div className="flex items-center justify-between mb-6">
            <div className="flex items-center gap-4">
              <div className="p-4 bg-gradient-to-br from-green-600 to-green-700 rounded-2xl shadow-xl shadow-green-200">
                <Umbrella className="h-8 w-8 text-white" />
              </div>
              <div>
                <h1 className="text-4xl font-bold text-gray-900 tracking-tight">
                  Reporte de Vacaciones
                </h1>
                <p className="text-gray-500 mt-1">
                  Consulta y gestión de solicitudes de vacaciones
                </p>
              </div>
            </div>
            <button
              onClick={() => cargarReporte()}
              className="p-3 bg-white hover:bg-gray-50 rounded-xl transition-all shadow-md hover:shadow-lg"
              title="Actualizar datos"
            >
              <RefreshCw size={18} className="text-gray-500" />
            </button>
          </div>

          {/* Stats Cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-6 mb-8">
            <StatCard
              label="Total Solicitudes"
              value={stats.total}
              icon={Users}
              color="blue"
            />
            <StatCard
              label="Aprobadas"
              value={stats.aprobados}
              icon={CheckCircle}
              color="green"
            />
            <StatCard
              label="Pendientes"
              value={stats.pendientes}
              icon={Clock}
              color="yellow"
            />
            <StatCard
              label="Negadas"
              value={stats.negados}
              icon={XCircle}
              color="red"
            />
          </div>
        </div>

        {/* Filtros - Mejorados */}
        <div className="bg-white rounded-2xl shadow-xl border border-gray-200 p-5 mb-8">
          <div className="flex flex-col md:flex-row gap-4">
            {/* Fecha */}
            <div className="flex items-center gap-3 bg-gray-50 rounded-xl px-4 py-2 border border-gray-200">
              <Calendar size={18} className="text-green-500" />
              <input
                type="date"
                value={fecha}
                onChange={handleFecha}
                className="bg-transparent border-none focus:outline-none focus:ring-0 text-gray-700 font-medium"
              />
              {fecha && (
                <button
                  onClick={() => {
                    setFecha("");
                    cargarReporte("", estado);
                  }}
                  className="text-xs text-gray-400 hover:text-gray-600 transition-colors"
                >
                  Limpiar
                </button>
              )}
            </div>

            {/* Estado */}
            <div className="relative flex-1 md:flex-none">
              <Filter className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
              <select
                value={estado}
                onChange={handleEstado}
                className="w-full md:w-[200px] border-2 border-gray-200 rounded-xl pl-9 pr-8 py-2.5 focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent appearance-none bg-white cursor-pointer"
              >
                {ESTADOS.map((e) => (
                  <option key={e} value={e}>
                    {e === "TODOS" ? "Todos los estados" : estadoLabel[e]}
                  </option>
                ))}
              </select>
              <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400 pointer-events-none" />
            </div>

            {/* Búsqueda */}
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Buscar por nombre, cédula o unidad..."
                className="w-full border-2 border-gray-200 rounded-xl pl-9 pr-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent transition-all"
              />
            </div>
          </div>
        </div>

        {/* Tabla de vacaciones */}
        <div className="bg-white rounded-2xl shadow-xl border border-gray-200 overflow-hidden">
          <div className="px-6 py-4 border-b border-gray-200 bg-gradient-to-r from-gray-50 to-white">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-green-100 rounded-lg">
                <FileText size={18} className="text-green-600" />
              </div>
              <div>
                <span className="font-semibold text-gray-900">
                  {filtrados.length} solicitud
                  {filtrados.length !== 1 ? "es" : ""}
                </span>
                <p className="text-xs text-gray-500 mt-0.5">
                  Registros encontrados
                </p>
              </div>
            </div>
          </div>

          {loading ? (
            <div className="flex flex-col items-center justify-center py-20">
              <Loader2 className="h-12 w-12 text-green-600 animate-spin mb-4" />
              <p className="text-gray-500 font-medium">Cargando reporte...</p>
            </div>
          ) : filtrados.length === 0 ? (
            <div className="p-20 text-center">
              <div className="inline-flex p-6 bg-gray-100 rounded-2xl mb-4">
                <Umbrella className="h-12 w-12 text-gray-400" />
              </div>
              <p className="text-gray-500 font-medium text-lg">
                No hay solicitudes de vacaciones
              </p>
              <p className="text-sm text-gray-400 mt-1">
                Prueba con otros filtros de búsqueda
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="bg-gradient-to-r from-gray-100 to-gray-50 border-b border-gray-200">
                    {[
                      "Servidor",
                      "Cédula",
                      "Unidad",
                      "Tipo",
                      "Período",
                      "Días",
                      "Jefe",
                      "Estado",
                      "PDF",
                    ].map((h) => (
                      <th
                        key={h}
                        className="text-left px-6 py-4 text-xs font-semibold text-gray-700 uppercase tracking-wider"
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {filtrados.map((v) => (
                    <tr
                      key={v.id}
                      className="hover:bg-gradient-to-r hover:from-green-50/50 hover:to-transparent transition-all duration-200 group"
                    >
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 rounded-full bg-green-100 flex items-center justify-center group-hover:scale-110 transition-transform">
                            <User size={14} className="text-green-600" />
                          </div>
                          <span className="font-medium text-gray-900 text-sm">
                            {v.servidor_nombre}
                          </span>
                        </div>
                      </td>
                      <td className="px-6 py-4 font-mono text-sm text-gray-600">
                        {v.cedula}
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-1.5">
                          <Building2 size={14} className="text-gray-400" />
                          <span className="text-sm text-gray-600 truncate max-w-[150px]">
                            {v.unidad_organica}
                          </span>
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <span
                          className={`inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium ${
                            v.tipo === "VACACION_PROGRAMADA"
                              ? "bg-blue-50 text-blue-700"
                              : "bg-purple-50 text-purple-700"
                          }`}
                        >
                          {v.tipo === "VACACION_PROGRAMADA"
                            ? "Programada"
                            : "Con Cargo"}
                        </span>
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex flex-col">
                          <span className="text-sm text-gray-700 font-medium">
                            {new Date(
                              v.fecha_inicio + "T12:00:00",
                            ).toLocaleDateString("es-ES", {
                              day: "2-digit",
                              month: "short",
                            })}
                          </span>
                          <span className="text-xs text-gray-400">
                            →{" "}
                            {new Date(
                              v.fecha_fin + "T12:00:00",
                            ).toLocaleDateString("es-ES", {
                              day: "2-digit",
                              month: "short",
                              year: "numeric",
                            })}
                          </span>
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <span className="inline-flex items-center gap-1 px-2.5 py-1.5 bg-green-100 text-green-700 rounded-lg text-sm font-semibold">
                          <Calendar size={12} />
                          {v.dias_solicitados} días
                        </span>
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-1.5">
                          <Users size={12} className="text-gray-400" />
                          <span className="text-sm text-gray-600 truncate max-w-[120px]">
                            {v.jefe_nombre || "—"}
                          </span>
                        </div>
                      </td>
                      <td className="px-6 py-4">{estadoBadge(v.estado)}</td>
                      <td className="px-6 py-4">
                        <button
                          onClick={() => handleDescargarPdf(v)}
                          className="flex items-center gap-1.5 px-3 py-1.5 bg-gradient-to-r from-green-600 to-green-700 text-white rounded-lg hover:from-green-700 hover:to-green-800 transition-all shadow-md hover:shadow-lg text-xs font-medium"
                          title="Descargar PDF de vacaciones"
                        >
                          <Download size={13} />
                          PDF
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

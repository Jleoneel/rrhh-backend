import { useEffect, useState, useMemo } from "react";
import {
  Users,
  Clock,
  Search,
  Plus,
  Eye,
  EyeOff,
  RefreshCw,
  Loader2,
  CheckCircle,
  XCircle,
  ChevronDown,
  Settings,
  Building2,
  Calendar,
  TrendingUp,
  AlertCircle,
  X,
} from "lucide-react";
import Swal from "sweetalert2";
import api from "../../../shared/api/axios";
import {
  getUsuariosServidor,
  crearUsuarioServidor,
  toggleUsuarioServidor,
  getSaldos,
  crearSaldo,
} from "../hooks/permisos.uath.service";

const TABS = [
  { id: "usuarios", label: "Usuarios Servidor", icon: Users },
  { id: "saldos", label: "Saldos", icon: Clock },
];

// eslint-disable-next-line no-unused-vars
const StatCard = ({ label, value, icon: Icon, color = "blue" }) => {
  const colors = {
    blue: "from-blue-500 to-blue-600",
    green: "from-green-500 to-green-600",
    yellow: "from-yellow-500 to-yellow-600",
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

export default function GestionPermisos() {
  const [tab, setTab] = useState("usuarios");
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(10);
  const [totalPages, setTotalPages] = useState(1);
  const [totalServidores, setTotalServidores] = useState(0);
  const [loadingTabla, setLoadingTabla] = useState(false);

  // Datos
  const [servidores, setServidores] = useState([]);
  const [saldos, setSaldos] = useState([]);

  // Filtros
  const [search, setSearch] = useState("");
  const [filtroUsuario, setFiltroUsuario] = useState("todos");

  // Modales
  const [modalSaldo, setModalSaldo] = useState(false);
  const [modalUsuario, setModalUsuario] = useState(false);
  const [servidorSeleccionado, setServidorSeleccionado] = useState(null);

  const [formSaldo, setFormSaldo] = useState({
    servidor_id: "",
    dias: 15,
    descripcion: "",
    fecha_ingreso: "",
  });
  const [formPassword, setFormPassword] = useState("");

  // Funciones de paginación y filtros
  const handlePageChange = (newPage) => {
    if (newPage >= 1 && newPage <= totalPages) {
      setPage(newPage);
      cargarServidores({ page: newPage, limit, search, filtro: filtroUsuario });
    }
  };

  const handleLimitChange = (newLimit) => {
    setLimit(newLimit);
    setPage(1);
    cargarServidores({
      page: 1,
      limit: newLimit,
      search,
      filtro: filtroUsuario,
    });
  };

  const handleSearch = (value) => {
    setSearch(value);
    setPage(1);
    cargarServidores({ page: 1, limit, search: value, filtro: filtroUsuario });
  };

  const handleFiltro = (value) => {
    setFiltroUsuario(value);
    setPage(1);
    cargarServidores({ page: 1, limit, search, filtro: value });
  };

  const cargarServidores = async (params = {}) => {
    setLoadingTabla(true);
    try {
      const result = await getUsuariosServidor({
        page: params.page || page,
        limit: params.limit || limit,
        search: params.search !== undefined ? params.search : search,
        filtro: params.filtro !== undefined ? params.filtro : filtroUsuario,
      });
      setServidores(result.data);
      setTotalPages(result.totalPages);
      setTotalServidores(result.total);
    } catch (err) {
      console.error(err);
    } finally {
      setLoadingTabla(false);
    }
  };

  const cargarDatos = async () => {
    setLoading(true);
    try {
      const [sal] = await Promise.all([
        getSaldos(),
        api.get("/catalogos/unidades-organicas").then((r) => r.data),
      ]);
      setSaldos(sal);
      await cargarServidores({ page: 1 });
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    cargarDatos();
  }, []);

  const stats = useMemo(
    () => ({
      total: totalServidores,
      conUsuario: servidores.filter((s) => s.usuario_id).length,
      sinUsuario: servidores.filter((s) => !s.usuario_id).length,
      conSaldo: saldos.length,
    }),
    [totalServidores, servidores, saldos],
  );

  const handleCrearUsuario = async () => {
    if (!formPassword || formPassword.length < 6) {
      Swal.fire({
        toast: true,
        icon: "warning",
        title: "Contraseña inválida",
        text: "La contraseña debe tener al menos 6 caracteres",
        timer: 2000,
        showConfirmButton: false,
        position: "top-end",
      });
      return;
    }
    try {
      await crearUsuarioServidor({
        servidor_id: servidorSeleccionado.servidor_id,
        password: formPassword,
      });
      Swal.fire({
        toast: true,
        icon: "success",
        title: "¡Usuario creado!",
        text: "Usuario creado correctamente",
        timer: 2000,
        showConfirmButton: false,
        position: "top-end",
      });
      setModalUsuario(false);
      setFormPassword("");
      cargarDatos();
    } catch (err) {
      Swal.fire({
        icon: "error",
        title: "Error",
        text: err.response?.data?.message || "Error creando usuario",
        confirmButtonColor: "#ef4444",
      });
    }
  };

  const handleToggleUsuario = async (servidor) => {
    const confirm = await Swal.fire({
      title: servidor.activo ? "¿Desactivar usuario?" : "¿Activar usuario?",
      html: `
        <div class="text-left">
          <p class="text-gray-600 mb-2">Usuario:</p>
          <p class="font-semibold text-gray-900">${servidor.nombres}</p>
          <p class="text-sm text-gray-500 mt-2">${servidor.cedula}</p>
        </div>
      `,
      icon: "question",
      showCancelButton: true,
      confirmButtonText: servidor.activo ? "Desactivar" : "Activar",
      confirmButtonColor: servidor.activo ? "#ef4444" : "#10b981",
      cancelButtonColor: "#6b7280",
    });
    if (!confirm.isConfirmed) return;
    try {
      await toggleUsuarioServidor(servidor.usuario_id, !servidor.activo);
      Swal.fire({
        toast: true,
        icon: "success",
        title: "Estado actualizado",
        text: `Usuario ${!servidor.activo ? "activado" : "desactivado"} correctamente`,
        timer: 1500,
        showConfirmButton: false,
        position: "top-end",
      });
      cargarDatos();
    } catch {
      Swal.fire({
        icon: "error",
        title: "Error",
        text: "No se pudo actualizar el estado",
        confirmButtonColor: "#ef4444",
      });
    }
  };

  const handleCrearSaldo = async () => {
    if (!formSaldo.servidor_id || !formSaldo.dias) {
      Swal.fire({
        toast: true,
        icon: "warning",
        title: "Campos incompletos",
        text: "Completa todos los campos",
        timer: 2000,
        showConfirmButton: false,
        position: "top-end",
      });
      return;
    }
    try {
      await crearSaldo(formSaldo);
      Swal.fire({
        toast: true,
        icon: "success",
        title: "¡Saldo asignado!",
        text: "Saldo asignado correctamente",
        timer: 2000,
        showConfirmButton: false,
        position: "top-end",
      });
      setModalSaldo(false);
      setFormSaldo({ servidor_id: "", dias: 15, descripcion: "", fecha_ingreso: ""});
      cargarDatos();
    } catch (err) {
      Swal.fire({
        icon: "error",
        title: "Error",
        text: err.response?.data?.message || "Error asignando saldo",
        confirmButtonColor: "#ef4444",
      });
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
                <Settings className="h-8 w-8 text-white" />
              </div>
              <div>
                <h1 className="text-4xl font-bold text-gray-900 tracking-tight">
                  Gestión de Permisos
                </h1>
                <p className="text-gray-500 mt-1">
                  Administración de usuarios, saldos y jefes de área
                </p>
              </div>
            </div>
            <button
              onClick={cargarDatos}
              className="p-3 bg-white hover:bg-gray-50 rounded-xl transition-all shadow-md hover:shadow-lg"
              title="Actualizar datos"
            >
              <RefreshCw size={18} className="text-gray-500" />
            </button>
          </div>

          {/* Stats Cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
            <StatCard
              label="Total Servidores"
              value={stats.total}
              icon={Users}
              color="blue"
            />
            <StatCard
              label="Con Usuario"
              value={stats.conUsuario}
              icon={CheckCircle}
              color="green"
            />
            <StatCard
              label="Sin Usuario"
              value={stats.sinUsuario}
              icon={AlertCircle}
              color="yellow"
            />
            <StatCard
              label="Con Saldo"
              value={stats.conSaldo}
              icon={TrendingUp}
              color="purple"
            />
          </div>
        </div>

        {/* Tabs */}
        <div className="bg-white rounded-2xl shadow-xl border border-gray-200 overflow-hidden">
          <div className="flex border-b border-gray-200 bg-gradient-to-r from-gray-50 to-white">
            {TABS.map((t) => {
              const Icon = t.icon;
              return (
                <button
                  key={t.id}
                  onClick={() => setTab(t.id)}
                  className={`flex items-center gap-2 px-6 py-4 text-sm font-medium transition-all duration-200 ${
                    tab === t.id
                      ? "border-b-2 border-blue-600 text-blue-600 bg-blue-50/50"
                      : "text-gray-500 hover:text-gray-700 hover:bg-gray-50"
                  }`}
                >
                  <Icon size={16} />
                  {t.label}
                </button>
              );
            })}
          </div>

          {loading ? (
            <div className="flex flex-col items-center justify-center py-20">
              <Loader2 className="h-12 w-12 text-blue-600 animate-spin mb-4" />
              <p className="text-gray-500 font-medium">
                Cargando información...
              </p>
            </div>
          ) : (
            <div className="p-6">
              {/* TAB: USUARIOS */}
              {tab === "usuarios" && (
                <div>
                  {/* Filtros */}
                  <div className="flex flex-col md:flex-row gap-4 mb-6">
                    <div className="relative flex-1">
                      <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-5 w-5 text-gray-400" />
                      <input
                        type="text"
                        value={search}
                        onChange={(e) => handleSearch(e.target.value)}
                        placeholder="Buscar por nombre o cédula..."
                        className="w-full border-2 border-gray-200 rounded-xl pl-11 pr-4 py-3 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all"
                      />
                    </div>
                    <div className="relative">
                      <select
                        value={filtroUsuario}
                        onChange={(e) => handleFiltro(e.target.value)}
                        className="border-2 border-gray-200 rounded-xl px-5 py-3 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent appearance-none pr-10 min-w-[180px] bg-white cursor-pointer"
                      >
                        <option value="todos">Todos los usuarios</option>
                        <option value="con_usuario">Con usuario creado</option>
                        <option value="sin_usuario">Sin usuario</option>
                      </select>
                      <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 h-5 w-5 text-gray-400 pointer-events-none" />
                    </div>
                  </div>

                  {/* Tabla */}
                  <div className="overflow-x-auto rounded-xl border border-gray-200">
                    <table className="w-full">
                      <thead>
                        <tr className="bg-gradient-to-r from-gray-100 to-gray-50 border-b border-gray-200">
                          {[
                            "Servidor",
                            "Cédula",
                            "Unidad",
                            "Usuario",
                            "Estado",
                            "Acciones",
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
                        {loadingTabla ? (
                          <tr>
                            <td colSpan={6} className="px-6 py-20 text-center">
                              <Loader2 className="h-8 w-8 text-blue-600 animate-spin mx-auto" />
                              <p className="text-gray-500 text-sm mt-2">
                                Cargando servidores...
                              </p>
                            </td>
                          </tr>
                        ) : servidores.length === 0 ? (
                          <tr>
                            <td colSpan={6} className="px-6 py-20 text-center">
                              <Users className="h-12 w-12 text-gray-300 mx-auto mb-3" />
                              <p className="text-gray-500 font-medium">
                                No se encontraron servidores
                              </p>
                              <p className="text-sm text-gray-400 mt-1">
                                Prueba con otros filtros de búsqueda
                              </p>
                            </td>
                          </tr>
                        ) : (
                          servidores.map((s) => (
                            <tr
                              key={s.servidor_id}
                              className="hover:bg-gray-50 transition-colors group"
                            >
                              <td className="px-6 py-4">
                                <div className="flex items-center gap-3">
                                  <div className="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center">
                                    <span className="text-blue-600 font-semibold text-sm">
                                      {s.nombres?.charAt(0) || "S"}
                                    </span>
                                  </div>
                                  <span className="font-semibold text-gray-900">
                                    {s.nombres}
                                  </span>
                                </div>
                              </td>
                              <td className="px-6 py-4 font-mono text-sm text-gray-600">
                                {s.cedula}
                              </td>
                              <td className="px-6 py-4">
                                <div className="flex items-center gap-1.5">
                                  <Building2
                                    size={14}
                                    className="text-gray-400"
                                  />
                                  <span className="text-sm text-gray-600">
                                    {s.unidad_organica || "—"}
                                  </span>
                                </div>
                              </td>
                              <td className="px-6 py-4">
                                {s.usuario_id ? (
                                  <span className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-green-100 text-green-700 rounded-full text-xs font-medium">
                                    <CheckCircle size={12} /> Creado
                                  </span>
                                ) : (
                                  <span className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-gray-100 text-gray-500 rounded-full text-xs font-medium">
                                    <XCircle size={12} /> Sin usuario
                                  </span>
                                )}
                              </td>
                              <td className="px-6 py-4">
                                {s.usuario_id &&
                                  (s.activo ? (
                                    <span className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-emerald-100 text-emerald-700 rounded-full text-xs font-medium">
                                      <CheckCircle size={12} /> Activo
                                    </span>
                                  ) : (
                                    <span className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-rose-100 text-rose-700 rounded-full text-xs font-medium">
                                      <XCircle size={12} /> Inactivo
                                    </span>
                                  ))}
                              </td>
                              <td className="px-6 py-4">
                                <div className="flex items-center gap-2">
                                  {!s.usuario_id ? (
                                    <button
                                      onClick={() => {
                                        setServidorSeleccionado(s);
                                        setModalUsuario(true);
                                      }}
                                      className="p-2 bg-blue-50 text-blue-600 hover:bg-blue-100 rounded-lg transition-all hover:scale-110"
                                      title="Crear usuario"
                                    >
                                      <Plus size={16} />
                                    </button>
                                  ) : (
                                    <button
                                      onClick={() => handleToggleUsuario(s)}
                                      className={`p-2 rounded-lg transition-all hover:scale-110 ${
                                        s.activo
                                          ? "bg-amber-50 text-amber-600 hover:bg-amber-100"
                                          : "bg-emerald-50 text-emerald-600 hover:bg-emerald-100"
                                      }`}
                                      title={
                                        s.activo ? "Desactivar" : "Activar"
                                      }
                                    >
                                      {s.activo ? (
                                        <EyeOff size={16} />
                                      ) : (
                                        <Eye size={16} />
                                      )}
                                    </button>
                                  )}
                                </div>
                              </td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>

                  {/* Paginación */}
                  {totalPages > 1 && (
                    <div className="flex items-center justify-between mt-6 pt-4 border-t border-gray-200">
                      <div className="flex items-center gap-3">
                        <span className="text-sm text-gray-500">
                          Mostrando{" "}
                          <b className="text-gray-900">{servidores.length}</b>{" "}
                          de <b className="text-gray-900">{totalServidores}</b>{" "}
                          servidores
                        </span>
                        <select
                          value={limit}
                          onChange={(e) =>
                            handleLimitChange(Number(e.target.value))
                          }
                          className="border border-gray-200 rounded-lg px-2 py-1.5 text-sm bg-white"
                        >
                          <option value={10}>10 por página</option>
                          <option value={25}>25 por página</option>
                          <option value={50}>50 por página</option>
                        </select>
                      </div>

                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => handlePageChange(page - 1)}
                          disabled={page === 1}
                          className="px-3 py-1.5 border border-gray-300 rounded-lg text-sm hover:bg-gray-100 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                        >
                          Anterior
                        </button>
                        <div className="flex items-center gap-1">
                          {Array.from(
                            { length: Math.min(5, totalPages) },
                            (_, i) => {
                              let pageNum;
                              if (totalPages <= 5) {
                                pageNum = i + 1;
                              } else if (page <= 3) {
                                pageNum = i + 1;
                              } else if (page >= totalPages - 2) {
                                pageNum = totalPages - 4 + i;
                              } else {
                                pageNum = page - 2 + i;
                              }
                              return (
                                <button
                                  key={pageNum}
                                  onClick={() => handlePageChange(pageNum)}
                                  className={`w-9 h-9 rounded-lg text-sm font-medium transition-all ${
                                    page === pageNum
                                      ? "bg-blue-600 text-white shadow-md"
                                      : "text-gray-600 hover:bg-gray-100"
                                  }`}
                                >
                                  {pageNum}
                                </button>
                              );
                            },
                          )}
                        </div>
                        <button
                          onClick={() => handlePageChange(page + 1)}
                          disabled={page === totalPages}
                          className="px-3 py-1.5 border border-gray-300 rounded-lg text-sm hover:bg-gray-100 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                        >
                          Siguiente
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* TAB: SALDOS */}
              {tab === "saldos" && (
                <div>
                  <div className="flex justify-end mb-6">
                    <button
                      onClick={() => setModalSaldo(true)}
                      className="flex items-center gap-2 px-5 py-3 bg-gradient-to-r from-blue-600 to-blue-700 text-white rounded-xl hover:from-blue-700 hover:to-blue-800 transition-all shadow-lg hover:shadow-xl"
                    >
                      <Plus size={16} /> Asignar saldo
                    </button>
                  </div>

                  <div className="overflow-x-auto rounded-xl border border-gray-200">
                    <table className="w-full">
                      <thead>
                        <tr className="bg-gradient-to-r from-gray-100 to-gray-50 border-b border-gray-200">
                          {[
                            "Servidor",
                            "Cédula",
                            "Unidad",
                            "Total",
                            "Usadas",
                            "Disponibles",
                            "Año",
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
                        {saldos.length === 0 ? (
                          <tr>
                            <td colSpan={7} className="px-6 py-20 text-center">
                              <Clock className="h-12 w-12 text-gray-300 mx-auto mb-3" />
                              <p className="text-gray-500 font-medium">
                                No hay saldos asignados
                              </p>
                              <p className="text-sm text-gray-400 mt-1">
                                Asigna saldos usando el botón superior
                              </p>
                            </td>
                          </tr>
                        ) : (
                          saldos.map((s) => (
                            <tr
                              key={s.id}
                              className="hover:bg-gray-50 transition-colors"
                            >
                              <td className="px-6 py-4 font-semibold text-gray-900">
                                {s.nombres}
                              </td>
                              <td className="px-6 py-4 font-mono text-sm text-gray-600">
                                {s.cedula}
                              </td>
                              <td className="px-6 py-4 text-sm text-gray-500">
                                {s.unidad_organica || "—"}
                              </td>
                              <td className="px-6 py-4">
                                <span className="inline-flex items-center gap-1 px-2 py-1 bg-blue-100 text-blue-700 rounded-lg text-sm font-semibold">
                                  {(parseFloat(s.horas_totales) / 8).toFixed(1)}{" "}
                                  días
                                </span>
                              </td>
                              <td className="px-6 py-4 text-amber-600 font-medium">
                                {(parseFloat(s.horas_usadas) / 8).toFixed(1)}{" "}
                                días
                              </td>
                              <td className="px-6 py-4">
                                <span
                                  className={`inline-flex items-center gap-1 px-2 py-1 rounded-lg text-sm font-bold ${
                                    s.horas_disponibles <= 0
                                      ? "bg-red-100 text-red-600"
                                      : "bg-green-100 text-green-600"
                                  }`}
                                >
                                  {(
                                    parseFloat(s.horas_disponibles) / 8
                                  ).toFixed(1)}{" "}
                                  días
                                </span>
                              </td>
                              <td className="px-6 py-4">
                                <span className="inline-flex items-center gap-1 px-2 py-1 bg-gray-100 rounded-lg text-xs font-mono">
                                  <Calendar size={12} /> {s.anio}
                                </span>
                              </td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Modal crear usuario */}
      {modalUsuario && servidorSeleccionado && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            onClick={() => setModalUsuario(false)}
          />
          <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-md mx-4 overflow-hidden">
            <div className="bg-gradient-to-r from-gray-900 to-gray-800 text-white px-6 py-5">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-white/10 rounded-lg">
                    <Users className="h-5 w-5" />
                  </div>
                  <div>
                    <h2 className="text-xl font-bold">Crear Usuario</h2>
                    <p className="text-sm text-gray-300">
                      {servidorSeleccionado.nombres}
                    </p>
                  </div>
                </div>
                <button
                  onClick={() => setModalUsuario(false)}
                  className="p-2 hover:bg-white/10 rounded-lg transition-all"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>
            </div>
            <div className="p-6">
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-2">
                    Contraseña inicial
                  </label>
                  <input
                    type="password"
                    value={formPassword}
                    onChange={(e) => setFormPassword(e.target.value)}
                    placeholder="Mínimo 6 caracteres"
                    className="w-full border-2 border-gray-200 rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  />
                  <p className="text-xs text-gray-400 mt-2 flex items-center gap-1">
                    <AlertCircle size={12} /> Recomendado: usar la cédula como
                    contraseña inicial
                  </p>
                </div>
              </div>
              <div className="flex gap-3 mt-6">
                <button
                  onClick={() => setModalUsuario(false)}
                  className="flex-1 px-4 py-3 border-2 border-gray-300 text-gray-700 rounded-xl font-medium hover:bg-gray-50 transition-all"
                >
                  Cancelar
                </button>
                <button
                  onClick={handleCrearUsuario}
                  className="flex-1 px-4 py-3 bg-gradient-to-r from-blue-600 to-blue-700 text-white rounded-xl font-medium hover:from-blue-700 hover:to-blue-800 transition-all shadow-lg"
                >
                  Crear Usuario
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Modal asignar saldo */}
      {modalSaldo && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            onClick={() => setModalSaldo(false)}
          />
          <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-md mx-4 overflow-hidden">
            <div className="bg-gradient-to-r from-gray-900 to-gray-800 text-white px-6 py-5">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-white/10 rounded-lg">
                    <Clock className="h-5 w-5" />
                  </div>
                  <div>
                    <h2 className="text-xl font-bold">Asignar Saldo</h2>
                    <p className="text-sm text-gray-300">Permisos anuales</p>
                  </div>
                </div>
                <button
                  onClick={() => setModalSaldo(false)}
                  className="p-2 hover:bg-white/10 rounded-lg transition-all"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>
            </div>
            <div className="p-6">
              <div className="space-y-5">
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-2">
                    Servidor
                  </label>
                  <select
                    value={formSaldo.servidor_id}
                    onChange={(e) =>
                      setFormSaldo((p) => ({
                        ...p,
                        servidor_id: e.target.value,
                      }))
                    }
                    className="w-full border-2 border-gray-200 rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent appearance-none cursor-pointer bg-white"
                  >
                    <option value="">Seleccione un servidor...</option>
                    {servidores.map((s) => (
                      <option key={s.servidor_id} value={s.servidor_id}>
                        {s.nombres} — {s.cedula}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-2">
                    Días de permiso
                  </label>
                  <input
                    type="number"
                    value={formSaldo.dias}
                    onChange={(e) =>
                      setFormSaldo((p) => ({
                        ...p,
                        dias: parseInt(e.target.value),
                      }))
                    }
                    className="w-full border-2 border-gray-200 rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    min={1}
                    max={30}
                  />
                  {formSaldo.dias && (
                    <p className="text-xs text-gray-500 mt-2 flex items-center gap-1">
                      <TrendingUp size={12} /> Equivale a{" "}
                      <span className="font-semibold text-blue-600">
                        {formSaldo.dias * 8} horas
                      </span>{" "}
                      ({formSaldo.dias} días × 8 horas)
                    </p>
                  )}
                </div>
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-2">
                    Fecha de ingreso <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="date"
                    value={formSaldo.fecha_ingreso || ""}
                    onChange={(e) =>
                      setFormSaldo((p) => ({
                        ...p,
                        fecha_ingreso: e.target.value,
                      }))
                    }
                    className="w-full border-2 border-gray-200 rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  />
                  <p className="text-xs text-gray-400 mt-1">
                    El saldo se acumulará cada mes en esta fecha
                  </p>
                </div>
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-2">
                    Descripción{" "}
                    <span className="text-gray-400 text-xs">(opcional)</span>
                  </label>
                  <input
                    type="text"
                    value={formSaldo.descripcion}
                    onChange={(e) =>
                      setFormSaldo((p) => ({
                        ...p,
                        descripcion: e.target.value,
                      }))
                    }
                    placeholder="Ej: Saldo inicial 2026"
                    className="w-full border-2 border-gray-200 rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  />
                </div>
              </div>
              <div className="flex gap-3 mt-6">
                <button
                  onClick={() => setModalSaldo(false)}
                  className="flex-1 px-4 py-3 border-2 border-gray-300 text-gray-700 rounded-xl font-medium hover:bg-gray-50 transition-all"
                >
                  Cancelar
                </button>
                <button
                  onClick={handleCrearSaldo}
                  className="flex-1 px-4 py-3 bg-gradient-to-r from-blue-600 to-blue-700 text-white rounded-xl font-medium hover:from-blue-700 hover:to-blue-800 transition-all shadow-lg"
                >
                  Asignar Saldo
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

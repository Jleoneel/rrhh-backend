import api from "../../../shared/api/axios";

export const getMiSaldo = () => api.get("/permisos/mi-saldo").then(r => r.data);
export const getMisPermisos = () => api.get("/permisos/mis-permisos").then(r => r.data);
export const getTiposPermiso = () => api.get("/permisos/tipos").then(r => r.data);
export const solicitarPermiso = (data) => api.post("/permisos/solicitar", data).then(r => r.data);
export const cancelarPermiso = (id) => api.put(`/permisos/${id}/cancelar`).then(r => r.data);
export const getMisVacaciones = () => api.get("/permisos/mis-vacaciones").then(r => r.data);
export const solicitarVacacion = (data) => api.post("/permisos/solicitar-vacacion", data).then(r => r.data);
export const cancelarVacacion = (id) => api.put(`/permisos/${id}/cancelar-vacacion`).then(r => r.data);
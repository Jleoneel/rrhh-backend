import { Router } from "express";
import { loginByCedula, cambiarPassword } from "./auth.controller.js";
import { requireAuth } from "../../shared/middleware/auth.middleware.js";


const router = Router();
    
router.post("/login", loginByCedula);
router.put("/cambiar-password",requireAuth, cambiarPassword);

export default router;

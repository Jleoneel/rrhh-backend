import { Router } from "express";
import { loginByCedula } from "../controllers/auth.controller.js";

const router = Router();

router.post("/login", loginByCedula);

export default router;

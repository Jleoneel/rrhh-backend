import bcrypt from "bcrypt";

const password = "1310717242";
const hash = await bcrypt.hash(password, 10);
console.log(hash);

import bcrypt from "bcrypt";

const password = "1315633139";
const hash = await bcrypt.hash(password, 10);
console.log(hash);

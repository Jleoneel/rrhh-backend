import bcrypt from "bcrypt";

const password = "1312890062";
const hash = await bcrypt.hash(password, 10);
console.log(hash);

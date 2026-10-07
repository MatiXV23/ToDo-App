/** Punto de entrada de migraciones para la imagen de producción (servicio `migrate`). */
import { runMigrations } from "./migrate";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL no está definida");
  process.exit(1);
}
runMigrations(url)
  .then(() => console.log("Migraciones aplicadas"))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });

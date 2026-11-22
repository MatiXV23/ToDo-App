#!/bin/sh
# Si el repo tiene .todoapp.json (lo escribe /todoapp:conectar), le cuenta a Claude a qué
# proyecto de ToDoApp corresponde y cómo nombrar ramas y PRs para que se vinculen solos.
# En repos sin vincular no imprime nada. Nunca falla: un hook roto no debe frenar la sesión.

root=$(git rev-parse --show-toplevel 2>/dev/null) || exit 0
file="$root/.todoapp.json"
[ -f "$file" ] || exit 0

field() { sed -n "s/.*\"$1\"[[:space:]]*:[[:space:]]*\"\([^\"]*\)\".*/\1/p" "$file" | head -n 1; }
key=$(field project | tr '[:lower:]' '[:upper:]')
case "$key" in
  [A-Z]*) ;;
  *) exit 0 ;;
esac
url=$(field url)
[ -n "$url" ] || url="${CLAUDE_PLUGIN_OPTION_URL:-}/p/$key"
lower=$(printf '%s' "$key" | tr '[:upper:]' '[:lower:]')

cat <<MSG
Este repositorio está vinculado al proyecto $key de ToDoApp ($url). Sus tareas se llaman $key-<número> y se gestionan con las herramientas del MCP de ToDoApp (get_board, get_task, create_task, move_task, add_comment…).
Para que ramas, commits y PRs se vinculen solos a una tarea, incluí su clave: rama \`$lower-12-descripcion-corta\`, commit y título del PR \`$key-12: …\`.
Para trabajar una tarea de punta a punta: /todoapp:tarea $key-12. Si piden anotar algo pendiente, creá la tarea en el proyecto $key.
MSG
exit 0

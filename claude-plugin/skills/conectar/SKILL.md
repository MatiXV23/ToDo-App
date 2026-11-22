---
name: conectar
description: Vincula el repositorio git actual con un proyecto de ToDoApp, creando el proyecto si no existe y conectando el repo de GitHub. Usar cuando pidan conectar o vincular este repo con ToDoApp, crear un proyecto de ToDoApp para este repo, o empezar a llevar las tareas de este código en ToDoApp.
argument-hint: "[clave o nombre del proyecto]"
---

# Vincular este repo con ToDoApp

Argumento opcional: `$ARGUMENTS` (la clave de un proyecto existente, como `TDA`, o el nombre para uno nuevo).

Usá las herramientas del MCP `todoapp` de este plugin. Si no aparecen, la conexión falló: pedile a la persona que revise la URL y el token del plugin (`claude plugin configure todoapp@todoapp`, el token sale de ToDoApp → Tokens de API) y frená.

## Pasos

1. **Datos del repo.** Corré `git rev-parse --show-toplevel` y `git remote get-url origin` (si no hay `origin`, `git remote -v` y usá el remoto de GitHub que haya).
   - Si ya existe `.todoapp.json` en la raíz, contá a qué proyecto apunta, confirmalo con `find_projects_by_repository` y terminá, salvo que pidan cambiarlo.
   - Si el repo no tiene remoto de GitHub, igual podés crear o elegir el proyecto y escribir `.todoapp.json`; avisá que sin repo en GitHub las ramas y los PRs no se vinculan solos.

2. **¿Ya hay un proyecto con este repo?** Llamá a `find_projects_by_repository` con la URL del remoto.
   - Uno: usá ese.
   - Varios: preguntá cuál.
   - Ninguno: seguí al paso 3.

3. **Elegir o crear el proyecto.**
   - Si `$ARGUMENTS` coincide con la clave de un proyecto de `list_projects`, usá `connect_repository` con esa clave y la URL del remoto.
   - Si no, usá `create_project` con `name` = `$ARGUMENTS` o, si viene vacío, el nombre del repo legible (`mi-tienda` → "Mi tienda"), y `repository` = la URL del remoto. No inventes la `key`: el servidor deriva una libre. No pidas confirmación salvo que haya ambigüedad real.

4. **Si falta acceso a GitHub** (`repositoryError` en la respuesta o error de `connect_repository`): el proyecto igual existe. Mostrale a la persona el enlace que viene en el mensaje, explicale que lo abra en el navegador con la sesión de ToDoApp iniciada y que instale la GitHub App con acceso a ese repo. Cuando avise que terminó, reintentá con `connect_repository`.

5. **Escribí `.todoapp.json`** en la raíz del repo:

   ```json
   { "project": "CLAVE", "url": "URL del proyecto que devolvió la herramienta" }
   ```

   Con ese archivo, cada sesión nueva de Claude Code en este repo sabe a qué proyecto pertenece. Sugerí commitearlo para que le sirva a todo el equipo, pero no lo commitees sin que lo pidan.

6. **Resumen breve:** clave y enlace del proyecto, repo conectado (o qué falta), y la convención para que todo se vincule solo:
   - ramas `clave-12-descripcion` (ej. `tda-12-arreglar-login`),
   - commits y títulos de PR con `CLAVE-12: …`,
   - `/todoapp:tarea CLAVE-12` para trabajar una tarea de punta a punta.

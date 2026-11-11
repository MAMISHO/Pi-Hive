# AGENTS.md (Pi-Hive)

Guía breve de contexto para asistentes/agents en este repositorio. Objetivo: minimizar lectura innecesaria y enfocar cambios.

## Qué es este proyecto
- **Pi-Hive**: orquestador multi-agente asíncrono (NestJS backend + Angular frontend), monorepo gestionado con **Nx**.
- Nombre de paquete raíz: `pi-hive` (`package.json`).

## Estructura relevante
- `apps/backend/` — API/orquestador NestJS.
  - `apps/backend/src/main.ts`, `apps/backend/src/app.module.ts` — entrypoints.
  - `apps/backend/src/app/backend/modules/` — módulos de dominio (p.ej. `agent-runner/`, `prompt-builder.service.ts`, etc.).
  - `apps/backend/prompts/` — prompts del sistema (assets incluidos en build).
- `apps/frontend/` — app Angular (dev server puerto `4900`).
- `scripts/` — utilidades/diagnóstico (p.ej. `audit-trace.sh`, `repro-planner-trace.mjs`).
- `tasks/` — material/tareas del proyecto (leer solo si es relevante).
- `test/` — pruebas/e2e según configuración del workspace.

## Directorios/artefactos a NO leer salvo necesidad explícita
- `node_modules/`, `dist/`, `.nx/`, `.angular/`, `coverage/`, `tmp/` — dependencias, builds y cachés.
- `data/`, `*.sqlite`, `database.sqlite` — datos locales/estado persistido.
- `package-lock.json` — lockfile grande; usar `package.json`/`nx.json` para entender scripts y config.
- `.git/` — historial interno de git.

> Nota: `.ignore` en la raíz define exclusiones para búsquedas/lectura contextual en herramientas compatibles.

## Comandos habituales (raíz)
- `npm run build` / `build:backend` / `build:frontend`
- `npm run start:dev` (backend) · `npm run start:frontend` (frontend, puerto 4900)
- `npm test` / `test:backend` / `test:frontend` / `test:e2e`
- `npm run lint`

## Convenciones de trabajo
- Nx workspace (`nx.json`, `apps/*/project.json`), TypeScript base en `tsconfig.base.json`.
- Preferir cambios mínimos y focalizados en `apps/backend` o `apps/frontend` según el issue.
- Antes de modificar prompts o lógica del runner, revisar el módulo concreto en `apps/backend/src/app/backend/modules/agent-runner/`.
- No editar artefactos generados (`dist/`, caches); editar fuentes en `apps/` y `scripts/`.
- Hay cambios locales en curso en algunos archivos de `agent-runner/` y prompts: revisar `git status`/diff antes de tocar esas áreas para no pisar trabajo en progreso.

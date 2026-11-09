# DocForge

DocForge is a template-based document generation service. Send it JSON data and a template ID, and it returns a ready-to-download PDF or PNG.

## Why I built this

Every time an application needs a downloadable document (a certificate, an official letter, a report), developers end up hand-coding the layout: coordinates, fonts, tables, page breaks. It is slow, hard to maintain, and has to be repeated for every new document type.

DocForge moves that work out of application code. A new document type only needs a new template, not a new implementation.

## Features

- **HTML templates to PDF/PNG**: design layouts with HTML/CSS and Handlebars placeholders, rendered with headless Chromium. Supports tables that span multiple pages.
- **PDF/PNG background overlay**: upload a finished design, define where each field goes, and DocForge fills it in. Ideal for certificates and forms.
- **Schema validation**: every template declares its required fields and types, with clear per-field error messages.
- **Batch generation**: generate hundreds of documents in one request, delivered as a ZIP.
- **Simple REST API**: one endpoint to generate, one to list templates.

## Quick start

    docker-compose up
    curl -X POST http://localhost:3000/generate \
      -H "x-api-key: YOUR_KEY" \
      -H "Content-Type: application/json" \
      -d '{"template": "certificate", "format": "pdf", "data": {"name": "Jane Doe"}}' \
      --output certificate.pdf

## Tech stack

Node.js, TypeScript, Fastify, Playwright, pdf-lib, BullMQ, Redis, Docker.

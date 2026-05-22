# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository purpose

This is a GitHub "special" profile repository — the repo name (`snrnoe/snrnoe`) matches the owner's username, which causes `README.md` at the root to be rendered on the owner's GitHub profile page at https://github.com/snrnoe.

There is no application code, build system, test suite, or package manifest. The entire deliverable is `README.md`.

## Working in this repo

- Edits are almost always to `README.md`. Treat it as user-facing content that will appear on the profile page, not as project documentation.
- GitHub Flavored Markdown is the rendering target. HTML comments (`<!--- ... --->`) are used in the existing file to hide notes from the rendered view — preserve that pattern when adding internal notes.
- There is nothing to build, lint, or test. Do not invent CI steps, package files, or tooling unless the user explicitly asks to introduce them.
- To preview changes, the user clicks the "Preview" link in the GitHub editor; there is no local preview workflow set up in the repo.

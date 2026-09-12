# Condui Community

Condui Community is the local, self-hosted edition of Condui, a tool for creating and maintaining
Belgian electrical installation diagrams. It is intended for people who want to keep their project
files and working environment under their own control.

The Community edition works without sign-in or a managed Condui service. Projects are stored in the
browser on the device running the application and can be downloaded as portable project archives.
These archives are fully compatible in both directions with the hosted, paid Condui edition: the
same project can be opened and edited in either edition and moved between them without conversion.

## What you can do

Condui Community includes the local editing workflow:

- create and edit one-wire diagrams;
- create and edit situation plans and panel layouts;
- store projects locally in the browser;
- import and download portable Condui project archives;
- import supported plan files using the bundled local conversion service;
- export finished diagrams to PDF; and
- open the included demo project without saving changes to your project list.

The interface is available in Dutch, French, and English.

## What is different from the hosted Condui product

Condui Community is deliberately local. Managed storage, synchronization, multi-user collaboration,
sharing, server-backed project history, and hosted integrations are not included.

Project templates are a hosted Condui feature and are not included in Community. Community projects
start from an empty local project or an imported project archive.

PDF exports contain the rendered document only. They do not contain an embedded editable Condui
project. Download and back up the project archive separately if you want to edit the project later.

Community installations are operated by the person or organization running them. There is no managed
backup, uptime guarantee, automatic server maintenance, or data recovery service.

## Run as a container

The published OCI image is available from GitHub Container Registry. Docker Compose pulls the
current image whenever you explicitly start or update the installation:

```bash
docker compose up -d
```

Open <http://localhost:8080> after the container has started. Stop it with:

```bash
docker compose down
```

This does not install a background auto-updater. Running `docker compose up -d` again checks GHCR,
pulls a changed image, and recreates the container when necessary.

Other OCI-compatible tools can use the same image. For example, with Podman:

```bash
podman pull ghcr.io/xoliul/condui-community:latest
podman run --rm -p 8080:8080 ghcr.io/xoliul/condui-community:latest
```

The container serves the application and the local file-conversion endpoints it needs. It does not
require a database or a separate backend service.

To build the image from the checked-out source instead:

```bash
docker build -t condui-community:local .
docker run --rm -p 8080:8080 condui-community:local
```

## Run from source

Condui Community requires Node.js 24 and npm.

```bash
npm install
npm run build
npm start
```

Then open <http://localhost:8080>.

`npm start` listens on loopback only by default; use `HOST=0.0.0.0 npm start` to expose it on the LAN.

This repository is generated from Condui's private development repository. Generated Community
snapshots contain only the source and assets required by the local edition.

## Project data and backups

Projects created in the application are stored in the browser profile used to open Condui Community.
Clearing browser data, deleting that profile, or losing the device can remove locally stored projects.

Use the project download function regularly and keep the resulting archive somewhere you back up.
The portable archive is the editable source of the project. The PDF is an output document, not a
replacement for that archive.

The archive structure and compatibility expectations are documented in
[`docs/project-file-format.md`](docs/project-file-format.md).

## Updates

Run the normal Compose command again to check for and install a newer published image:

```bash
docker compose up -d
```

Back up important project archives before updating. Compatibility with supported project archives is
maintained through the documented import and migration path, but keeping your own backups remains
important.

## Licence and permitted use

Condui Community is source-available under the
[PolyForm Perimeter License 1.0.1](LICENSE). In practical terms:

- you may use it personally or professionally, including for paid electrical work;
- you may study, modify, fork, and redistribute the Community source;
- you must include the licence and required notices when you redistribute it;
- you may build independent tools that read and write the documented Condui project format;
- you may not sell, rebrand, host, or otherwise offer Condui Community or a modified version as a
  competing product or service, even if that substitute is offered for free; and
- the Condui name and visual identity are not licensed for use on a fork or competing product.

This summary is informational. The [`LICENSE`](LICENSE) file contains the authoritative terms. Contact
Studio Oplos VOF if you need permission beyond those terms.

## Contributions and support

Contribution and support processes will be documented when the Community repository is published.
For now, use the private Condui development workflow for testing and review.

Condui Community can assist with drawing and documenting an installation, but it does not guarantee
regulatory compliance or acceptance by an inspection body. The installer and project owner remain
responsible for the installation and its documentation.

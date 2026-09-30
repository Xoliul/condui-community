import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'
import fs from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { pwaManifest } from './pwa.config.mjs'

const repoRoot = path.resolve(import.meta.dirname, '../..')
const appRoot = import.meta.dirname

/**
 * pdf.js decodes JBIG2/CCITT fax images, JPEG 2000, and ICC colour with WebAssembly modules it
 * loads by name from `wasmUrl`. Without them pdf.js drops the rest of a page that uses such an
 * image. Serve the installed version's files at `/pdfjs-wasm/` in dev and ship them in builds.
 */
const PDFJS_WASM_FILES = [
  'jbig2.wasm',
  'openjpeg.wasm',
  'qcms_bg.wasm',
  'LICENSE_JBIG2',
  'LICENSE_OPENJPEG',
  'LICENSE_QCMS',
  'LICENSE_PDFJS_JBIG2',
  'LICENSE_PDFJS_OPENJPEG',
  'LICENSE_PDFJS_QCMS',
] as const

function pdfjsWasmDirectory(): string {
  const requireFromApp = createRequire(import.meta.url)
  return path.join(path.dirname(requireFromApp.resolve('pdfjs-dist/package.json')), 'wasm')
}

function createPdfjsWasmPlugin() {
  return {
    name: 'pdfjs-wasm-assets',
    configureServer(server: {
      middlewares: {
        use: (
          handler: (
            req: { url?: string },
            res: { setHeader: (name: string, value: string) => void; end: (body: Buffer) => void },
            next: () => void
          ) => void
        ) => void
      }
    }) {
      server.middlewares.use((req, res, next) => {
        const match = req.url?.match(/^\/pdfjs-wasm\/([A-Za-z0-9_.-]+)(?:\?.*)?$/)
        const fileName = match?.[1]
        if (!fileName || !(PDFJS_WASM_FILES as readonly string[]).includes(fileName)) return next()
        res.setHeader(
          'Content-Type',
          fileName.endsWith('.wasm') ? 'application/wasm' : 'text/plain; charset=utf-8'
        )
        res.end(fs.readFileSync(path.join(pdfjsWasmDirectory(), fileName)))
      })
    },
    generateBundle(this: {
      emitFile: (file: { type: 'asset'; fileName: string; source: Uint8Array }) => string
    }) {
      const directory = pdfjsWasmDirectory()
      for (const fileName of PDFJS_WASM_FILES) {
        this.emitFile({
          type: 'asset',
          fileName: `pdfjs-wasm/${fileName}`,
          source: fs.readFileSync(path.join(directory, fileName)),
        })
      }
    },
  }
}

function isBuildFlagEnabled(value: unknown): boolean {
  if (typeof value !== 'string') return false
  return ['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase())
}

/**
 * Documents follow the same build flag as hosted builds (Vite reads the same env files for the
 * `community` mode), minus their hosted-only parts.
 */
const projectDocumentsEnabled = isBuildFlagEnabled(
  process.env.VITE_ENABLE_PROJECT_DOCUMENTS ??
    loadEnv('community', appRoot, '').VITE_ENABLE_PROJECT_DOCUMENTS,
)

export function normalizeCommunityModuleIds(
  moduleIds: Iterable<string>,
  root = repoRoot,
): string[] {
  const normalizedRoot = root.replaceAll('\\', '/').replace(/\/+$/, '')
  const rootPrefix = `${normalizedRoot}/`
  return [...moduleIds]
    .map((id) => id.replaceAll('\\', '/'))
    .filter((id) => id.startsWith(rootPrefix))
    .map((id) => id.slice(rootPrefix.length))
    .sort()
}

const hostedTemplateModulePaths = [
  'apps/app/src/components/home/NewProjectDialog.tsx',
  'apps/app/src/components/home/TemplateCard.tsx',
  'apps/app/src/lib/projectManagement.ts',
  'apps/app/src/lib/projectStorage/adapters/supabaseEditorCloudProjectAdapter.ts',
  'apps/app/src/pages/Home.tsx',
  'apps/app/src/pages/ProjectPage.tsx',
] as const

export function assertNoHostedTemplateModules(moduleIds: Iterable<string>): void {
  const leaked = [...new Set(moduleIds)].filter((moduleId) =>
    hostedTemplateModulePaths.includes(moduleId as (typeof hostedTemplateModulePaths)[number]),
  )
  if (leaked.length > 0) {
    throw new Error(
      `Community build includes hosted template module(s): ${leaked.join(', ')}`,
    )
  }
}

const hostedDxfModulePrefixes = [
  'apps/app/src/components/export/DxfExportDialog.tsx',
  'apps/app/src/hooks/useDxfExportDialog.tsx',
  'apps/app/src/lib/export/dxf/',
  `apps/app/src/lib/export/${'dxf'}ElectricalOverlayExport.ts`,
] as const

export function assertNoHostedDxfModules(moduleIds: Iterable<string>): void {
  const leaked = [...new Set(moduleIds)].filter((moduleId) =>
    hostedDxfModulePrefixes.some(
      (prefix) => moduleId === prefix || moduleId.startsWith(prefix),
    ),
  )
  if (leaked.length > 0) {
    throw new Error(`Community build includes hosted DXF module(s): ${leaked.join(', ')}`)
  }
}

const electricalVisionModulePrefixes = [
  'apps/app/src/components/vision/',
  'apps/app/src/lib/vision/',
] as const

export function assertNoElectricalVisionModules(moduleIds: Iterable<string>): void {
  const leaked = [...new Set(moduleIds)].filter((moduleId) =>
    electricalVisionModulePrefixes.some((prefix) => moduleId.startsWith(prefix)),
  )
  if (leaked.length > 0) {
    throw new Error(`Community build includes electrical vision module(s): ${leaked.join(', ')}`)
  }
}

const projectDocumentsModulePrefixes = [
  'apps/app/src/components/documents/',
  'apps/app/src/lib/documents/',
  'apps/app/src/stores/projectDocumentsStore',
  'apps/app/src/stores/externalInfluencesDocuments',
] as const

/** Hosted-only parts of Documents: paid-project tables, the team library, paid gating. */
const hostedProjectDocumentsModulePrefixes = [
  'apps/app/src/components/documents/documentsHostedFeatures',
  'apps/app/src/components/documents/ExternalInfluence',
  'apps/app/src/components/documents/PaidFeatureGate',
  'apps/app/src/components/documents/TeamLibraryPicker',
  'apps/app/src/components/documents/usePaidProjectAccess',
  'apps/app/src/components/documents/useRequestProjectUpgrade',
  'apps/app/src/components/documents/useSaveToTeamLibrary',
  'apps/app/src/components/documents/useTeamDocumentLibraryAccess',
  'apps/app/src/lib/documents/externalInfluence',
  'apps/app/src/lib/documents/limitedDocumentPages',
  'apps/app/src/lib/documents/teamDocument',
  'apps/app/src/stores/externalInfluencesDocuments',
] as const

/**
 * Without the Documents flag no Documents module may reach the community build; with it, only
 * the hosted-only ones may not.
 */
export function assertNoProjectDocumentsModules(
  moduleIds: Iterable<string>,
  { documentsEnabled = false }: { documentsEnabled?: boolean } = {},
): void {
  const prefixes = documentsEnabled
    ? hostedProjectDocumentsModulePrefixes
    : projectDocumentsModulePrefixes
  const leaked = [...new Set(moduleIds)].filter((moduleId) =>
    prefixes.some((prefix) => moduleId.startsWith(prefix)),
  )
  if (leaked.length > 0) {
    throw new Error(
      `Community build includes ${documentsEnabled ? 'hosted ' : ''}project documents module(s): ${leaked.join(', ')}`,
    )
  }
}

function stripProjectDocumentsSource(source: string): string {
  return source
    .replace(
      /\{\s*\/\*\s*@project-documents-strip-start\s*\*\/\s*\}[\s\S]*?\{\s*\/\*\s*@project-documents-strip-end\s*\*\/\s*\}/g,
      '',
    )
    .replace(
      /\/\*\s*@project-documents-strip-start\s*\*\/[\s\S]*?\/\*\s*@project-documents-strip-end\s*\*\//g,
      '',
    )
}

function stripDisabledElectricalVisionScanSource(source: string): string {
  return source
    .replace(
      /\{\s*\/\*\s*@vision-scan-strip-start\s*\*\/\s*\}[\s\S]*?\{\s*\/\*\s*@vision-scan-strip-end\s*\*\/\s*\}/g,
      '',
    )
    .replace(
      /\/\*\s*@vision-scan-strip-start\s*\*\/[\s\S]*?\/\*\s*@vision-scan-strip-end\s*\*\//g,
      '',
    )
}

const aliases = {
  '@/lib/vision/availability': './src/editions/community/communityPlanRecognition.ts',
  '@/lib/vision/recognizePlanWalls': './src/editions/community/communityPlanRecognition.ts',
  '@/hooks/useExportDialog': './src/editions/community/useCommunityExportDialog.tsx',
  '@/hooks/useAuthSession': './src/editions/community/communityAuthSession.ts',
  '@/components/home/NewProjectDialog':
    './src/editions/community/CommunityNewProjectDialog.tsx',
  '@/components/export/ExportDialog': './src/editions/community/CommunityExportDialog.tsx',
  '@/lib/editionPdfRenderingPolicy': './src/editions/community/communityPdfRenderingPolicy.ts',
  '@/components/documents/documentsHostedFeatures':
    './src/editions/community/communityDocumentsHostedFeatures.tsx',
  '@/lib/db': './src/editions/community/communityDb.ts',
  '@/lib/ui/homeButtonStyles':
    './src/editions/community/communityHomeButtonStyles.ts',
  '@/lib/installerProfile': './src/editions/community/communityInstallerProfile.ts',
  '@/lib/analytics/googleAnalytics': './src/editions/community/communityAnalytics.ts',
  '@eendra/analytics': './src/editions/community/communityAnalytics.ts',
  '@/lib/analytics/validationPanelAnalytics': './src/editions/community/communityAnalytics.ts',
  '@/lib/analytics/editorEventAnalytics': './src/editions/community/communityAnalytics.ts',
  '@/lib/analytics/supplyAssemblyAnalytics': './src/editions/community/communityAnalytics.ts',
  '@/lib/inspectionAgencyCatalog':
    './src/editions/community/communityInspectionAgencyCatalog.ts',
  '@/lib/synergridCatalog': './src/editions/community/communitySynergridCatalog.ts',
  '@/hooks/useEditionFeatureAvailability':
    './src/editions/community/useCommunityFeatureAvailability.ts',
  '@/components/properties/editors/InstallerProperties':
    './src/editions/community/CommunityInstallerProperties.tsx',
} as const

function cleanOutput() {
  for (const relativePath of [
    'print-labels',
    'docs-learning',
    '_headers',
    '_redirects',
    'tutorial-config.local.example.json',
    'vite.svg',
  ]) {
    fs.rmSync(path.resolve(appRoot, 'dist', relativePath), { recursive: true, force: true })
  }
  const socialRoot = path.resolve(appRoot, 'dist', 'social')
  if (!fs.existsSync(socialRoot)) return
  for (const fileName of fs.readdirSync(socialRoot)) {
    if (!fileName.startsWith('condui-app-preview.')) {
      fs.rmSync(path.join(socialRoot, fileName), { force: true })
    }
  }
}

function createCommunitySourceBoundaryPlugin() {
  return {
    name: 'community-source-boundary',
    enforce: 'pre' as const,
    resolveId(source: string) {
      return source === '/src/main.tsx' ? path.resolve(appRoot, 'src/main.community.tsx') : null
    },
    transformIndexHtml(html: string) {
      return html.replace(
        /<!--\s*@community-strip-start\s*-->[\s\S]*?<!--\s*@community-strip-end\s*-->/g,
        '',
      )
    },
    transform(source: string, id: string) {
      let code = stripDisabledElectricalVisionScanSource(source)
      if (!projectDocumentsEnabled) code = stripProjectDocumentsSource(code)
      code = code.replace(
        /\/\*\s*@community-strip-start\s*\*\/[\s\S]*?\/\*\s*@community-strip-end\s*\*\//g,
        '',
      )
      if (/[/\\]src[/\\].+\.[jt]sx?$/.test(id)) {
        code = code
          .replaceAll("from '@/hooks'", "from '@/editions/community/communityHooks'")
          .replaceAll(
            "from '@eendra/installer-profile'",
            "from '@/editions/community/communityInstallerProfileModel'",
          )
      }
      return code === source ? null : code
    },
  }
}

export default defineConfig({
  plugins: [
    createPdfjsWasmPlugin(),
    {
      ...createCommunitySourceBoundaryPlugin(),
      generateBundle() {
        const modules = normalizeCommunityModuleIds(this.getModuleIds())
        assertNoHostedTemplateModules(modules)
        assertNoHostedDxfModules(modules)
        assertNoElectricalVisionModules(modules)
        assertNoProjectDocumentsModules(modules, { documentsEnabled: projectDocumentsEnabled })
        fs.writeFileSync(
          path.resolve(appRoot, '.community-module-audit.local.json'),
          `${JSON.stringify({ modules: [...new Set(modules)] }, null, 2)}\n`,
        )
      },
      writeBundle: cleanOutput,
    },
    react(),
    VitePWA({
      registerType: 'prompt',
      injectRegister: false,
      manifest: pwaManifest,
      includeAssets: [
        'fonts/Figtree/**/*',
        'fonts/OpenSans/**/*',
        'pwa/icon-192.png',
        'pwa/icon-512.png',
        'pwa/icon-512-maskable.png',
        'symbols/**/*',
        'plan-graphics/**/*',
        'examples/starter-project.zip',
      ],
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff,woff2,ttf,wasm,webmanifest,zip}'],
        globIgnores: [
          'print-labels/**',
          'docs-learning/**',
        ],
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/api\//],
        clientsClaim: true,
        cleanupOutdatedCaches: true,
        maximumFileSizeToCacheInBytes: 8 * 1024 * 1024,
        runtimeCaching: [
          {
            urlPattern: ({ url }) =>
              url.pathname.startsWith('/symbols/') || url.pathname.startsWith('/plan-graphics/'),
            handler: 'CacheFirst',
            options: {
              cacheName: 'static-diagram-assets',
              expiration: { maxEntries: 400, maxAgeSeconds: 60 * 60 * 24 * 365 },
            },
          },
        ],
      },
    }),
    {
      name: 'community-csp',
      transformIndexHtml(html) {
        const policy = [
          "default-src 'self'",
          "script-src 'self' 'unsafe-eval' 'wasm-unsafe-eval'",
          "style-src 'self' 'unsafe-inline'",
          "img-src 'self' data: blob:",
          "font-src 'self' data:",
          "worker-src 'self' blob:",
          "frame-src 'self' blob:",
          "connect-src 'self'",
          "object-src 'none'",
          "base-uri 'self'",
          "frame-ancestors 'none'",
        ].join('; ')
        return html.replace(
          '</head>',
          `    <meta http-equiv="Content-Security-Policy" content="${policy}" />\n  </head>`,
        )
      },
    },
  ],
  worker: {
    plugins: () => [createCommunitySourceBoundaryPlugin()],
  },
  resolve: {
    alias: {
      ...Object.fromEntries(
        Object.entries(aliases).map(([key, value]) => [key, path.resolve(appRoot, value)]),
      ),
      '@': path.resolve(appRoot, 'src'),
      '@eendra/app-edition': path.resolve(repoRoot, 'packages/app-edition/src/index.ts'),
      '@eendra/ui': path.resolve(repoRoot, 'packages/ui/src'),
    },
  },
  build: { sourcemap: false },
})

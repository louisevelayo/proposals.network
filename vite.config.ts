import inject from '@rollup/plugin-inject';
import { sveltekit } from '@sveltejs/kit/vite';
import { readFileSync } from 'fs';
import { join } from 'node:path';
import { dirname } from 'path';
import { fileURLToPath } from 'url';
import { defineConfig, loadEnv, type UserConfig } from 'vite';

const file = fileURLToPath(new URL('package.json', import.meta.url));
const json = readFileSync(file, 'utf8');
const { version } = JSON.parse(json);

// npm run dev = local
// npm run build = local
// dfx deploy = local
// dfx deploy --network ic = ic
// dfx deploy --network staging = staging
const network = process.env.DFX_NETWORK ?? 'local';

const readCanisterIds = ({ prefix }: { prefix?: string }): Record<string, string> => {
	const canisterIdsJsonFile = ['ic', 'staging'].includes(network)
		? join(process.cwd(), 'canister_ids.json')
		: join(process.cwd(), '.dfx', 'local', 'canister_ids.json');

	try {
		type Details = {
			ic?: string;
			staging?: string;
			local?: string;
		};

		const config: Record<string, Details> = JSON.parse(readFileSync(canisterIdsJsonFile, 'utf-8'));

		return Object.entries(config).reduce((acc, current: [string, Details]) => {
			const [canisterName, canisterDetails] = current;

			return {
				...acc,
				[`${prefix ?? ''}${canisterName.toUpperCase()}_CANISTER_ID`]:
					canisterDetails[network as keyof Details]
			};
		}, {});
	} catch (e) {
		console.warn(`Could not get canister ID from ${canisterIdsJsonFile}: ${e}`);
		return {};
	}
};

const dfxCanisterIds = ({ prefix }: { prefix?: string }): Record<string, string> => {
	if (['ic', 'staging'].includes(network)) {
		return {};
	}

	const dfxJsonFile = join(process.cwd(), 'dfx.json');

	try {
		type Details = {
			remote?: {
				id: {
					ic: string;
					local: string;
				};
			};
		};

		type DfxJson = {
			canisters: Record<string, Details>;
		};

		const { canisters }: DfxJson = JSON.parse(readFileSync(dfxJsonFile, 'utf-8'));

		return Object.entries(canisters).reduce((acc, current: [string, Details]) => {
			const [canisterName, canisterDetails] = current;

			if (canisterDetails.remote !== undefined) {
				return {
					...acc,
					[`${prefix ?? ''}${canisterName
						.replaceAll('-', '_')
						.replaceAll("'", '')
						.toUpperCase()}_CANISTER_ID`]: canisterDetails.remote.id.local
				};
			}

			return acc;
		}, {});
	} catch (e) {
		console.warn(`Could not get canisters ID from ${dfxJsonFile}: ${e}`);
		return {};
	}
};

const config: UserConfig = {
	plugins: [sveltekit()],
	build: {
		target: 'es2020',
		rollupOptions: {
			output: {
				manualChunks: (id) => {
					const folder = dirname(id);

					const lazy = ['@dfinity/nns', '@dfinity/nns-proto'];

					if (
						['@sveltejs', 'svelte', ...lazy].find((lib) => folder.includes(lib)) === undefined &&
						folder.includes('node_modules')
					) {
						return 'vendor';
					}

					if (
						lazy.find((lib) => folder.includes(lib)) !== undefined &&
						folder.includes('node_modules')
					) {
						return 'lazy';
					}

					return 'index';
				}
			},
			// Polyfill Buffer for production build
			plugins: [
				inject({
					modules: { Buffer: ['buffer', 'Buffer'] }
				})
			]
		}
	},
	optimizeDeps: {
		esbuildOptions: {
			define: {
				global: 'globalThis'
			},
			plugins: [
				{
					name: 'fix-node-globals-polyfill',
					setup(build) {
						build.onResolve({ filter: /_virtual-process-polyfill_\.js/ }, ({ path }) => ({ path }));
					}
				}
			]
		}
	},
	worker: {
		format: 'es'
	}
};

export default defineConfig((): UserConfig => {
	// Expand environment - .env files - with canister IDs
	process.env = {
		...process.env,
		...loadEnv(
			network === 'ic' ? 'production' : network === 'staging' ? 'staging' : 'development',
			process.cwd()
		),
		...readCanisterIds({ prefix: 'VITE_' }),
		...dfxCanisterIds({ prefix: 'VITE_' })
	};

	console.log({
		...process.env,
		...loadEnv(
			network === 'ic' ? 'production' : network === 'staging' ? 'staging' : 'development',
			process.cwd()
		),
		...readCanisterIds({ prefix: 'VITE_' }),
		...dfxCanisterIds({ prefix: 'VITE_' })
	});

	return {
		...config,
		// Backwards compatibility for auto generated types of dfx that are meant for webpack and process.env
		define: {
			'process.env': {
				...readCanisterIds({}),
				...dfxCanisterIds({}),
				DFX_NETWORK: network
			},
			'import.meta.env.VITE_APP_VERSION': JSON.stringify(version),
			'import.meta.env.VITE_DFX_NETWORK': JSON.stringify(network)
		}
	};
});

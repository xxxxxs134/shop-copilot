import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTs from 'eslint-config-next/typescript';
import prettier from 'eslint-config-prettier';

/**
 * ESLint 9 原生 flat config。
 * eslint-config-next@16 直接导出 flat 配置数组，无需 FlatCompat 桥接。
 */
const eslintConfig = [
  ...nextVitals,
  ...nextTs,
  prettier,
  { ignores: ['.next/**', 'node_modules/**', 'next-env.d.ts'] },
];

export default eslintConfig;

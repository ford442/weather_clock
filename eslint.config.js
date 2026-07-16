import js from '@eslint/js';
import globals from 'globals';

export default [
    {
        ignores: ['dist/**', 'src/vendor/**']
    },
    js.configs.recommended,
    {
        files: ['src/**/*.js'],
        languageOptions: {
            ecmaVersion: 'latest',
            sourceType: 'module',
            globals: globals.browser
        },
        rules: {
            'no-dupe-keys': 'error',
            'no-unused-vars': [
                'error',
                {
                    argsIgnorePattern: '^_',
                    caughtErrors: 'none',
                    varsIgnorePattern: '^_'
                }
            ],
            eqeqeq: ['error', 'smart'],
            'no-undef': 'error'
        }
    },
    {
        files: ['src/tests/**/*.js'],
        languageOptions: {
            globals: {
                ...globals.browser,
                ...globals.node
            }
        }
    }
];

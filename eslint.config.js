import config, {browserES10} from '@bhsd/code-standard';

export default [
	...config,
	browserES10,
	{
		files: ['src/*.ts'],
		rules: {
			curly: [
				2,
				'multi-line',
			],
			'logical-assignment-operators': 0,
			'no-cond-assign': 0,
			'no-useless-assignment': 0,
			'prefer-template': 0,
			'require-unicode-regexp': 0,
			'@stylistic/arrow-parens': [
				2,
				'always',
			],
			'@stylistic/comma-dangle': 0,
			'@stylistic/eol-last': [
				2,
				'never',
			],
			'@stylistic/indent': [
				2,
				2,
			],
			'@stylistic/lines-around-comment': 0,
			'@stylistic/max-len': 0,
			'@stylistic/member-delimiter-style': [
				2,
				{
					singleline: {
						delimiter: 'semi',
					},
				},
			],
			'@stylistic/object-curly-spacing': [
				2,
				'always',
			],
			'@stylistic/operator-linebreak': [
				2,
				'after',
				{
					overrides: {
						'?': 'before',
						':': 'before',
					},
				},
			],
			'@stylistic/quotes': [
				2,
				'double',
			],
			'@typescript-eslint/class-methods-use-this': 0,
			'@typescript-eslint/explicit-function-return-type': 0,
			'@typescript-eslint/method-signature-style': 0,
			'@typescript-eslint/no-confusing-void-expression': 0,
			'@typescript-eslint/no-shadow': [
				2,
				{
					builtinGlobals: false,
				},
			],
			'@typescript-eslint/prefer-destructuring': 0,
			'jsdoc/check-indentation': 0,
			'jsdoc/require-jsdoc': 0,
			'jsdoc/require-param': 0,
			'unicorn/explicit-length-check': 0,
			'unicorn/no-for-each': 0,
			'unicorn/prefer-ternary': 0,
			'unicorn/prefer-spread': 0,
		},
	},
];

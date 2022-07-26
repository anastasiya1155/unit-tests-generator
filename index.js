const fs = require('fs/promises');
const { parse } = require('@babel/parser');
const prettier = require('prettier');

const typeValuesMap = {
  TSNumberKeyword: '1',
  TSBooleanKeyword: 'true',
  TSStringKeyword: '"string"',
  TSUnionType: '"union"',
  TSTypeLiteral: '{number: 1}',
};

const run = (sourceFilePath) => {
  fs.readFile(sourceFilePath).then((res) => {
    const content = res.toString();
    const parsed = parse(content, {
      plugins: ['typescript'],
      sourceType: 'module',
    });
    const fileBody = parsed.program.body;
    const testSetsFor = [];
    const imports = [];
    const functionDeclarations = [];
    fileBody.forEach((node) => {
      if (
        node.type === 'FunctionDeclaration' ||
        (node.type === 'VariableDeclaration' &&
          node.declarations?.[0]?.init?.type === 'ArrowFunctionExpression')
      ) {
        console.log(node);
        functionDeclarations.push(node);
      }
      if (node.type === 'ExportNamedDeclaration') {
        if (node.declaration.type === 'FunctionDeclaration') {
          testSetsFor.push({
            name: node.declaration.id?.name,
            params: node.declaration.params.map((p) => ({
              name: p.name || p.left?.name,
              type:
                p.typeAnnotation?.typeAnnotation?.type ||
                p.left?.typeAnnotation?.typeAnnotation?.type,
            })),
          });
        }
        if (
          node.declaration.type === 'VariableDeclaration' &&
          node.declaration.declarations?.[0]?.init?.type ===
            'ArrowFunctionExpression'
        ) {
          testSetsFor.push({
            name: node.declaration.declarations[0].id.name,
            params: node.declaration.declarations[0].init.params.map((p) => ({
              name: p.name || p.left?.name,
              type:
                p.typeAnnotation?.typeAnnotation?.type ||
                p.left?.typeAnnotation?.typeAnnotation?.type,
            })),
          });
        }
      }
      if (node.type === 'ExportDefaultDeclaration') {
        let funcDeclaration = node.declaration;
        if (node.declaration.type === 'Identifier' && node.declaration.name) {
          funcDeclaration = functionDeclarations.find(
            (n) =>
              node.declaration.name === n.id?.name ||
              node.declaration.name === n.declarations?.[0]?.id?.name,
          );
        }
        console.log('funcDeclaration', funcDeclaration);
        testSetsFor.push({
          name: node.declaration.name || 'defaultExport',
          params: (
            funcDeclaration.declarations?.[0].init || funcDeclaration
          ).params.map((p) => ({
            name: p.name || p.left?.name,
            type:
              p.typeAnnotation?.typeAnnotation?.type ||
              p.left?.typeAnnotation?.typeAnnotation?.type,
          })),
        });
      }
      if (node.type === 'ImportDeclaration') {
        imports.push({
          type: 'import',
          from: node.source.value,
          specifiers: node.specifiers.map((sp) => ({
            imported: sp.imported?.name || 'default',
            local: sp.local.name,
          })),
        });
      }
      if (
        node.type === 'VariableDeclaration' &&
        node.declarations?.[0]?.init?.type === 'CallExpression' &&
        node.declarations?.[0]?.init?.callee?.name === 'require'
      ) {
        imports.push({
          type: 'require',
          from: node.declarations[0].init.arguments[0].value,
          specifiers: node.declarations[0].id.properties?.map((pr) => ({
            imported: pr.key.name,
            local: pr.value.name,
          })) || [{ imported: 'default', local: node.declarations[0].id.name }],
        });
      }
    });
    console.log(JSON.stringify(testSetsFor));

    const testFile = `${imports
      .filter((im) => !im.from.startsWith('.'))
      .map((im) => {
        const defaultImport = im.specifiers.find(
          (sp) => sp.imported === 'default',
        );
        const namedImports = im.specifiers.filter(
          (sp) => sp.imported !== 'default',
        );
        const specifiersString = `${defaultImport ? defaultImport.local : ''}${
          namedImports.length
            ? `{${namedImports.map((ni) => ni.imported).join(', ')}}`
            : ''
        }`;
        const mocks = `\n jest.mock('${im.from}'${
          defaultImport
            ? ''
            : `, () => {
        return {${namedImports
          .map((ni) => `${ni.imported}: jest.fn()`)
          .join(', ')}}
      }`
        });`;
        return im.type === 'import'
          ? `import ${specifiersString} from '${im.from}';${mocks}`
          : `const ${specifiersString} = require('${im.from}');${mocks}`;
      })
      .join('\n')}
  import {${testSetsFor
    .map((t) => t.name)
    .join(', ')}} from '${sourceFilePath}';
  
  describe('index.js', () => {
    ${testSetsFor
      .map(
        ({ name, params }) => `describe('${name}', () => {
      it('does not throw error', () => {
        expect(${name}(${params
          .map((p) => typeValuesMap[p.type] || 'undefined')
          .join(',')})).not.toThrow();
      });
    });`,
      )
      .join('\n')}
  })
  `;

    const [fileName, ...pathParts] = sourceFilePath.split('/').reverse();
    const path = pathParts.reverse().join('/');

    fs.writeFile(
      `${path}/${fileName.split('.').slice(0, -1).join('.')}.test.js`,
      prettier.format(testFile, { parser: 'babel' }),
    );
  });
};

module.exports = { run };

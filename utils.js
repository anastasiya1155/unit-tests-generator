const typeValuesMap = {
  TSNumberKeyword: '1',
  TSBooleanKeyword: 'true',
  TSStringKeyword: '"string"',
  TSUnionType: '"union"',
  TSTypeLiteral: '{number: 1}',
};

const getParamName = (param) => param.name || param.left?.name;
const getParamType = (param) =>
  param.typeAnnotation?.typeAnnotation?.type ||
  param.left?.typeAnnotation?.typeAnnotation?.type;

const getParams = (params) => {
  return params.map((p) => ({
    name: getParamName(p),
    type: getParamType(p),
  }));
};

const parseFuncDeclaration = (node) => {
  return {
    name: node.declaration.id?.name,
    params: getParams(node.declaration.params),
  };
};

const parseArrowFunction = (node) => {
  return {
    name: node.declaration.declarations[0].id.name,
    params: getParams(node.declaration.declarations[0].init.params),
  };
};

const extractImportsExports = (fileBody) => {
  const exportedFuncs = [];
  const imports = [];
  const functionDeclarations = [];

  fileBody.forEach((node) => {
    if (
      node.type === 'FunctionDeclaration' ||
      (node.type === 'VariableDeclaration' &&
        node.declarations?.[0]?.init?.type === 'ArrowFunctionExpression')
    ) {
      functionDeclarations.push(node);
    }
    if (node.type === 'ExportNamedDeclaration') {
      if (node.declaration.type === 'FunctionDeclaration') {
        exportedFuncs.push(parseFuncDeclaration(node));
      }
      if (
        node.declaration.type === 'VariableDeclaration' &&
        node.declaration.declarations?.[0]?.init?.type ===
          'ArrowFunctionExpression'
      ) {
        exportedFuncs.push(parseArrowFunction(node));
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
      exportedFuncs.push({
        name: node.declaration.name || 'defaultExport',
        params: getParams(
          funcDeclaration.declarations?.[0]?.init?.params ||
            funcDeclaration?.params,
        ),
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

  return { imports, exportedFuncs };
};

const generateImportsAndMocks = (imports, exportedFuncs, sourceFileName) => {
  const mocks = [];
  return `${imports
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
      mocks.push(
        `jest.mock('${im.from}'${
          defaultImport
            ? ''
            : `, () => {
        return {${namedImports
          .map((ni) => `${ni.imported}: jest.fn()`)
          .join(', ')}}
      }`
        });`,
      );
      return im.type === 'import'
        ? `import ${specifiersString} from '${im.from}';`
        : `const ${specifiersString} = require('${im.from}');`;
    })
    .join('\n')}
  import {${exportedFuncs
    .map((t) => t.name)
    .join(', ')}} from './${sourceFileName}';
    
    ${mocks.join('\n')}`;
};

const generateTestsBlock = (exportedFuncs) => {
  return `describe('index.js', () => {
    ${exportedFuncs
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
  })`;
};

const getTestFileName = (path, originalFileName) =>
  `${path}/${originalFileName.split('.').slice(0, -1).join('.')}.test.js`;

const getPathAndName = (sourceFilePath) => {
  const [fileName, ...pathParts] = sourceFilePath.split('/').reverse();
  const path = pathParts.reverse().join('/');
  return { path, fileName };
};

module.exports = {
  extractImportsExports,
  generateImportsAndMocks,
  generateTestsBlock,
  getTestFileName,
  getPathAndName,
};

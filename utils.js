const typeValuesMap = {
  TSNumberKeyword: '1',
  TSBooleanKeyword: 'true',
  TSStringKeyword: '"string"',
  TSUnionType: '"union"',
  TSTypeLiteral: '{number: 1}',
  TSArrayType: '[]',
  Date: `'${new Date().toDateString()}'`,
};

const getParamName = (param) => param.name || param.left?.name || param.start;
const getParamType = (param, isTypeNode = false) => {
  if (!param) {
    return undefined;
  }
  const p = isTypeNode
    ? param
    : param.typeAnnotation?.typeAnnotation ||
      param.left?.typeAnnotation?.typeAnnotation;
  let type = p?.type;

  if (type === 'TSTypeReference') {
    type = p.typeName.name;
  }
  if (type === 'TSTypeLiteral') {
    type = `Object-${param.start}`;
    typeValuesMap[type] = `{${
      p?.members.map(
        (m) => `${m.key.name}: ${typeValuesMap[getParamType(m)]}`,
      ) || ''
    }}`;
  }
  if (type === 'TSArrayType') {
    type = `Array-${param.start}`;
    typeValuesMap[type] = `[${
      typeValuesMap[
        getParamType(param.typeAnnotation?.typeAnnotation?.elementType, true)
      ]
    }]`;
  }
  if (type === 'TSUnionType') {
    type = `Union-${param.start}`;
    typeValuesMap[type] = p.types
      .map((t) => `${typeValuesMap[getParamType(t, true)]}`)
      .join(' | ');
  }
  return type;
};

const getParams = (params) => {
  return params.map((p) => ({
    name: getParamName(p),
    type: getParamType(p),
    optional: p.optional,
    default: p.right?.value,
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
        exportedAsDefault: true,
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
  const defaultExportFunc = exportedFuncs.find((f) => f.exportedAsDefault);
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
  import ${
    defaultExportFunc ? defaultExportFunc.name + ', ' : ''
  }{${exportedFuncs
    .filter((sp) => !sp.exportedAsDefault)
    .map((t) => t.name)
    .join(', ')}} from './${sourceFileName}';
    
    ${mocks.join('\n')}`;
};

const getParamValue = (param, unionIndex = 0) => {
  if (param.type?.startsWith('Union')) {
    return typeValuesMap[param.type].split(' | ')[unionIndex];
  }
  return typeValuesMap[param.type] || 'undefined';
};

const getTestWrapper = (name, params, variant) => `it('does not throw error${
  variant ? `, param variant ${variant}` : ''
}', () => {
        expect(() => ${name}(${params.join(',')})).not.toThrow();
      });`;

const generateTestsBlock = (exportedFuncs) => {
  const funcsTests = exportedFuncs.map(({ name, params }) => {
    const paramsTests = [getTestWrapper(name, params.map(getParamValue))];
    const unionParams = params.filter((p) => p.type?.startsWith('Union'));
    if (unionParams.length) {
      unionParams.forEach((up, j) => {
        const types = typeValuesMap[up.type].split(' | ');
        for (let i = 1; i < types.length; i++) {
          paramsTests.push(
            getTestWrapper(
              name,
              params.map((p) => getParamValue(p, p.type === up.type ? i : 0)),
              `${j + 1}-${i + 1}`,
            ),
          );
        }
      });
    }
    const optionalParams = params.filter((p) => p.optional);
    if (optionalParams.length) {
      optionalParams.forEach((op, i) => {
        paramsTests.push(
          getTestWrapper(
            name,
            params.map((p) => {
              if (p.name === op.name) {
                return 'undefined';
              }
              return getParamValue(p);
            }),
            i + 1,
          ),
        );
      });
    }
    return `describe('${name}', () => {
      ${paramsTests.join('\n')}
    });`;
  });
  return `describe('index.js', () => {
    ${funcsTests.join('\n\n')}
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

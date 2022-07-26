const fs = require('fs/promises');
const { parse } = require('@babel/parser');
const prettier = require('prettier');
const {
  extractImportsExports,
  generateImportsAndMocks,
  generateTestsBlock,
  getTestFileName,
  getPathAndName,
} = require('./utils');

const run = (sourceFilePath) => {
  const { path, fileName } = getPathAndName(sourceFilePath);
  fs.readFile(sourceFilePath).then((res) => {
    const content = res.toString();
    const parsed = parse(content, {
      plugins: ['typescript'],
      sourceType: 'module',
    });
    const fileBody = parsed.program.body;

    const { imports, exportedFuncs } = extractImportsExports(fileBody);

    const testFile = `${generateImportsAndMocks(
      imports,
      exportedFuncs,
      fileName,
    )}
  
  ${generateTestsBlock(exportedFuncs)}
  `;

    fs.writeFile(
      getTestFileName(path, fileName),
      prettier.format(testFile, { parser: 'babel' }),
    );
  });
};

module.exports = { run };

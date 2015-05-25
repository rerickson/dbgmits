﻿// Copyright (c) 2015 Vadim Macagon
// MIT License, see LICENSE file for full terms.

/// <reference path="../typings/test/tsd.d.ts" />

require('source-map-support').install();

import * as chai from 'chai';
import chaiAsPromised = require('chai-as-promised');
import * as dbgmits from '../src/dbgmits';
import { startDebugSession, runToFunc, runToFuncAndStepOut } from '../test/test_utils';

chai.use(chaiAsPromised);

// aliases
import expect = chai.expect;
import DebugSession = dbgmits.DebugSession;

// the directory in which Gruntfile.js resides is also Mocha's working directory,
// so any relative paths will be relative to that directory
var localTargetExe: string = './build/Debug/data_tests_target';
// source line number of main() (must be updated if data_tests_target.cpp is modified!)
var mainFuncLineNum = 44;

describe("Debug Session", () => {
  describe("Data Inspection and Manipulation", () => {
    var debugSession: DebugSession;

    beforeEach(() => {
      debugSession = startDebugSession();
      return debugSession.setExecutableFile(localTargetExe);
    });

    afterEach(() => {
      return debugSession.end();
    });

    it("#evaluateExpression", () => {
      return runToFuncAndStepOut(debugSession, 'expressionEvaluationBreakpoint', () => {
        return debugSession.evaluateExpression('a')
        .then((value: string) => { expect(value).to.equal('1'); })
        .then(() => { return debugSession.evaluateExpression('a + b'); })
        .then((value: string) => { expect(value).to.equal('3'); })
        .then(() => { return debugSession.evaluateExpression('c.x * c.y'); })
        .then((value: string) => { expect(value).to.equal('25'); })
        .then(() => { return debugSession.evaluateExpression('get10()'); })
        .then((value: string) => { expect(value).to.equal('10'); })
        .then(() => { return debugSession.evaluateExpression('get10() * get10()'); })
        .then((value: string) => { expect(value).to.equal('100'); })
        .then(() => { return debugSession.evaluateExpression('get10() == 10'); })
        .then((value: string) => { expect(value).to.equal('true'); })
        .then(() => { return debugSession.evaluateExpression('get10() == getInt(10)'); })
        .then((value: string) => { expect(value).to.equal('true'); })
        .then(() => { 
          return debugSession.evaluateExpression('a == 1', { threadId: 1, frameLevel: 0 }); 
        })
        .then((value: string) => { expect(value).to.equal('true'); });
      });
    });

    describe("#readMemory", () => {
      it("reads memory at an address specified as a hex literal", () => {
        return runToFuncAndStepOut(debugSession, 'memoryAccessBreakpoint', () => {
          return debugSession.evaluateExpression('&array')
          .then((address: string) => {
            return debugSession.readMemory(address, 4)
            .then((blocks: dbgmits.IMemoryBlock[]) => {
              expect(blocks.length).to.equal(1);
              expect(blocks[0]).to.have.property('begin');
              expect(parseInt(blocks[0].begin, 16)).to.equal(parseInt(address, 16));
              expect(blocks[0]).to.have.property('end');
              expect(blocks[0]).to.have.property('offset');
              expect(blocks[0]).to.have.property('contents', '01020304');
            });
          })
        });
      });

      it("reads memory at an address obtained from an expression", () => {
        return runToFuncAndStepOut(debugSession, 'memoryAccessBreakpoint', () => {
          return debugSession.readMemory('&array', 4)
          .then((blocks: dbgmits.IMemoryBlock[]) => {
            expect(blocks.length).to.equal(1);
            expect(blocks[0]).to.have.property('contents', '01020304');
          });
        });
      });

      it("reads memory at an address with an offset", () => {
        return runToFuncAndStepOut(debugSession, 'memoryAccessBreakpoint', () => {
          return debugSession.evaluateExpression('&array')
          .then((address: string) => {
            return debugSession.readMemory(address, 2, { byteOffset: 2 });
          })
          .then((blocks: dbgmits.IMemoryBlock[]) => {
            expect(blocks.length).to.equal(1);
            expect(blocks[0]).to.have.property('contents', '0304');
          });
        });
      });
    });

    it("#getRegisterNames", () => {
      return runToFunc(debugSession, 'main', () => {
        return debugSession.getRegisterNames()
        .then((registerNames: string[]) => { expect(registerNames.length).to.be.greaterThan(0); })
        .then(() => { return debugSession.getRegisterNames([1, 2, 3]); })
        .then((registerNames: string[]) => { expect(registerNames.length).to.equal(3); });
      });
    });

    it("#getRegisterValues", () => {
      return runToFunc(debugSession, 'main', () => {
        return debugSession.getRegisterValues(dbgmits.RegisterValueFormatSpec.Hexadecimal)
        .then((registerValues: Map<number, string>) => {
          expect(registerValues.size).to.be.greaterThan(0);
          /* FIXME: LLDB-MI produces some malformed values, needs to be fixed.
          var hexRe = /^0x[0-9a-f]+$/i;
          registerValues.forEach((value) => {
            expect(value).to.match(hexRe);
          });
          */
        })
        .then(() => {
          return debugSession.getRegisterValues(
            dbgmits.RegisterValueFormatSpec.Hexadecimal, { registers: [1, 2, 3] }
          );
        })
        .then((registerValues: Map<number, string>) => {
          expect(registerValues.size).to.equal(3);
        });
      });
    });

    it("#disassembleAddressRange", () => {
      return runToFunc(debugSession, 'main', () => {
        return debugSession.evaluateExpression('&main')
        .then((value: string) => {
          let matches = /^0x[0-9a-f]+/i.exec(value);
          expect(matches).not.null;
          let end = '0x' + (parseInt(matches[0], 16) + 10).toString(16);
          return debugSession.disassembleAddressRange(matches[0], end);
        })
        .then((instructions: dbgmits.IAsmInstruction[]) => {
          expect(instructions.length).to.be.greaterThan(0);
          expect(instructions[0]).to.have.property('address');
          expect(instructions[0]).to.have.property('func');
          expect(instructions[0]).to.have.property('offset');
          expect(instructions[0]).to.have.property('inst');
        });
      });
    });

    // FIXME: LLDB-MI doesn't format the output correctly in mixed mode, re-enable when it does
    it("#disassembleAddressRangeByLine @skipOnLLDB", () => {
      return runToFunc(debugSession, 'main', () => {
        return debugSession.evaluateExpression('&main')
        .then((value: string) => {
          let matches = /^0x[0-9a-f]+/i.exec(value);
          expect(matches).not.null;
          let end = parseInt(matches[0], 16) + 10;
          return debugSession.disassembleAddressRangeByLine(matches[0], '0x' + end.toString(16));
        })
        .then((lines: dbgmits.ISourceLineAsm[]) => {
          expect(lines.length).to.be.greaterThan(0);
          expect(lines[0].instructions.length).to.be.greaterThan(0);
        });
      });
    });

    // FIXME: LLDB-MI doesn't support file/line arguments yet, re-enable when it does
    it("#disassembleFile a file @skipOnLLDB", () => {
      return runToFunc(debugSession, 'main', () => {
        // disassemble main()
        return debugSession.disassembleFile('data_tests_target.cpp', mainFuncLineNum, -1)
        .then((instructions: dbgmits.IAsmInstruction[]) => {
          expect(instructions.length).to.be.greaterThan(0);
        }); 
      });
    });

    // FIXME: LLDB-MI doesn't support file/line arguments yet, and it doesn't format output correctly
    // in mixed mode, re-enable when it does both of those things properly
    it("#disassembleFileByLine @skipOnLLDB", () => {
      return runToFunc(debugSession, 'main', () => {
        // disassemble main()
        return debugSession.disassembleFileByLine('data_tests_target.cpp', mainFuncLineNum, -1)
        .then((lines: dbgmits.ISourceLineAsm[]) => {
          expect(lines.length).to.be.greaterThan(0);
          expect(lines[0].instructions.length).to.be.greaterThan(0);
        });
      });
    });
  });
});

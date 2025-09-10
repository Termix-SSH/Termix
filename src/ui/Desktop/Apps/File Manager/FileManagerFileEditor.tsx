import React, {useState, useEffect} from "react";
import CodeMirror from "@uiw/react-codemirror";
import {loadLanguage} from '@uiw/codemirror-extensions-langs';
import {hyperLink} from '@uiw/codemirror-extensions-hyper-link';
import {oneDark} from '@codemirror/theme-one-dark';
import {EditorView} from '@codemirror/view';

interface FileManagerCodeEditorProps {
    content: string;
    fileName: string;
    onContentChange: (value: string) => void;
}

export function FileManagerFileEditor({content, fileName, onContentChange}: FileManagerCodeEditorProps) {
    function getLanguageName(filename: string): string {
        if (!filename || typeof filename !== 'string') {
            return 'text';
        }
        const lastDotIndex = filename.lastIndexOf('.');
        if (lastDotIndex === -1) {
            return 'text';
        }
        const ext = filename.slice(lastDotIndex + 1).toLowerCase();

        switch (ext) {
            case 'ng':
                return 'angular';
            case 'apl':
                return 'apl';
            case 'asc':
                return 'asciiArmor';
            case 'ast':
                return 'asterisk';
            case 'bf':
                return 'brainfuck';
            case 'c':
                return 'c';
            case 'ceylon':
                return 'ceylon';
            case 'clj':
                return 'clojure';
            case 'cmake':
                return 'cmake';
            case 'cob':
            case 'cbl':
                return 'cobol';
            case 'coffee':
                return 'coffeescript';
            case 'lisp':
                return 'commonLisp';
            case 'cpp':
            case 'cc':
            case 'cxx':
                return 'cpp';
            case 'cr':
                return 'crystal';
            case 'cs':
                return 'csharp';
            case 'css':
                return 'css';
            case 'cypher':
                return 'cypher';
            case 'd':
                return 'd';
            case 'dart':
                return 'dart';
            case 'diff':
            case 'patch':
                return 'diff';
            case 'dockerfile':
                return 'dockerfile';
            case 'dtd':
                return 'dtd';
            case 'dylan':
                return 'dylan';
            case 'ebnf':
                return 'ebnf';
            case 'ecl':
                return 'ecl';
            case 'eiffel':
                return 'eiffel';
            case 'elm':
                return 'elm';
            case 'erl':
                return 'erlang';
            case 'factor':
                return 'factor';
            case 'fcl':
                return 'fcl';
            case 'fs':
                return 'forth';
            case 'f90':
            case 'for':
                return 'fortran';
            case 's':
                return 'gas';
            case 'feature':
                return 'gherkin';
            case 'go':
                return 'go';
            case 'groovy':
                return 'groovy';
            case 'hs':
                return 'haskell';
            case 'hx':
                return 'haxe';
            case 'html':
            case 'htm':
                return 'html';
            case 'http':
                return 'http';
            case 'idl':
                return 'idl';
            case 'java':
                return 'java';
            case 'js':
            case 'mjs':
            case 'cjs':
                return 'javascript';
            case 'jinja2':
            case 'j2':
                return 'jinja2';
            case 'json':
                return 'json';
            case 'jsx':
                return 'jsx';
            case 'jl':
                return 'julia';
            case 'kt':
            case 'kts':
                return 'kotlin';
            case 'less':
                return 'less';
            case 'lezer':
                return 'lezer';
            case 'liquid':
                return 'liquid';
            case 'litcoffee':
                return 'livescript';
            case 'lua':
                return 'lua';
            case 'md':
                return 'markdown';
            case 'nb':
            case 'mat':
                return 'mathematica';
            case 'mbox':
                return 'mbox';
            case 'mmd':
                return 'mermaid';
            case 'mrc':
                return 'mirc';
            case 'moo':
                return 'modelica';
            case 'mscgen':
                return 'mscgen';
            case 'm':
                return 'mumps';
            case 'sql':
                return 'mysql';
            case 'nc':
                return 'nesC';
            case 'nginx':
                return 'nginx';
            case 'nix':
                return 'nix';
            case 'nsi':
                return 'nsis';
            case 'nt':
                return 'ntriples';
            case 'mm':
                return 'objectiveCpp';
            case 'octave':
                return 'octave';
            case 'oz':
                return 'oz';
            case 'pas':
                return 'pascal';
            case 'pl':
            case 'pm':
                return 'perl';
            case 'pgsql':
                return 'pgsql';
            case 'php':
                return 'php';
            case 'pig':
                return 'pig';
            case 'ps1':
                return 'powershell';
            case 'properties':
                return 'properties';
            case 'proto':
                return 'protobuf';
            case 'pp':
                return 'puppet';
            case 'py':
                return 'python';
            case 'q':
                return 'q';
            case 'r':
                return 'r';
            case 'rb':
                return 'ruby';
            case 'rs':
                return 'rust';
            case 'sas':
                return 'sas';
            case 'sass':
            case 'scss':
                return 'sass';
            case 'scala':
                return 'scala';
            case 'scm':
                return 'scheme';
            case 'shader':
                return 'shader';
            case 'sh':
            case 'bash':
                return 'shell';
            case 'siv':
                return 'sieve';
            case 'st':
                return 'smalltalk';
            case 'sol':
                return 'solidity';
            case 'solr':
                return 'solr';
            case 'rq':
                return 'sparql';
            case 'xlsx':
            case 'ods':
            case 'csv':
                return 'spreadsheet';
            case 'nut':
                return 'squirrel';
            case 'tex':
                return 'stex';
            case 'styl':
                return 'stylus';
            case 'svelte':
                return 'svelte';
            case 'swift':
                return 'swift';
            case 'tcl':
                return 'tcl';
            case 'textile':
                return 'textile';
            case 'tiddlywiki':
                return 'tiddlyWiki';
            case 'tiki':
                return 'tiki';
            case 'toml':
                return 'toml';
            case 'troff':
                return 'troff';
            case 'tsx':
                return 'tsx';
            case 'ttcn':
                return 'ttcn';
            case 'ttl':
            case 'turtle':
                return 'turtle';
            case 'ts':
                return 'typescript';
            case 'vb':
                return 'vb';
            case 'vbs':
                return 'vbscript';
            case 'vm':
                return 'velocity';
            case 'v':
                return 'verilog';
            case 'vhd':
            case 'vhdl':
                return 'vhdl';
            case 'vue':
                return 'vue';
            case 'wat':
                return 'wast';
            case 'webidl':
                return 'webIDL';
            case 'xq':
            case 'xquery':
                return 'xQuery';
            case 'xml':
                return 'xml';
            case 'yacas':
                return 'yacas';
            case 'yaml':
            case 'yml':
                return 'yaml';
            case 'z80':
                return 'z80';
            default:
                return 'text';
        }
    }

    useEffect(() => {
        document.body.style.overflowX = 'hidden';
        return () => {
            document.body.style.overflowX = '';
        };
    }, []);

    return (
        <div className="w-full h-full relative overflow-hidden flex flex-col">
            <div
                className="w-full h-full overflow-auto flex-1 flex flex-col config-codemirror-scroll-wrapper"
            >
                <CodeMirror
                    value={content}
                    extensions={[
                        loadLanguage(getLanguageName(fileName || 'untitled.txt') as any) || [],
                        hyperLink,
                        oneDark,
                        EditorView.theme({
                            '&': {
                                backgroundColor: 'var(--color-dark-bg-darkest) !important',
                            },
                            '.cm-gutters': {
                                backgroundColor: 'var(--color-dark-bg) !important',
                            },
                        })
                    ]}
                    onChange={(value: any) => onContentChange(value)}
                    theme={undefined}
                    height="100%"
                    basicSetup={{lineNumbers: true}}
                    className="min-h-full min-w-full flex-1"
                />
            </div>
        </div>
    );
}
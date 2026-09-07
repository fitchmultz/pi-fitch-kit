"""Real Node/Pi restart checks. Only synthetic files and this harness's owned PTYs/PIDs."""
from pathlib import Path
import argparse
import errno
import json
import os
import pty
import resource
import secrets
import select
import shlex
import shutil
import signal
import socket
import struct
import sys
import termios
import time
import uuid
import fcntl

REPO = Path(__file__).resolve().parent.parent
HELPER = REPO / 'extensions/session-restart.ts'
FIXTURE = REPO / 'scripts/session-restart-fixture.ts'


def records(root):
    path = root / 'events.jsonl'
    return [json.loads(line) for line in path.read_text().splitlines()] if path.exists() else []


def rpc(path, payload, timeout=1):
    with socket.socket(socket.AF_UNIX) as connection:
        connection.settimeout(timeout)
        connection.connect(str(path))
        connection.sendall((json.dumps(payload) + '\n').encode())
        data = b''
        while b'\n' not in data:
            part = connection.recv(16384)
            if not part:
                raise EOFError('helper closed before reply')
            data += part
        return json.loads(data.split(b'\n')[0])


def session_file(root, name='session.jsonl', empty=False):
    file = root / name
    sid = str(uuid.uuid4())
    header = {'type': 'session', 'version': 3, 'id': sid, 'timestamp': '2026-09-07T12:00:00Z', 'cwd': str(root / 'native')}
    usage = {'input': 0, 'output': 0, 'cacheRead': 0, 'cacheWrite': 0, 'totalTokens': 0,
             'cost': {'input': 0, 'output': 0, 'cacheRead': 0, 'cacheWrite': 0, 'total': 0}}
    entries = [
        {'type': 'message', 'message': {'role': 'user', 'content': 'first synthetic context ' + 'a' * 8000, 'timestamp': 0}},
        {'type': 'model_change', 'provider': 'restart-a', 'modelId': 'one'},
        {'type': 'thinking_level_change', 'thinkingLevel': 'low'},
        {'type': 'message', 'message': {'role': 'assistant', 'content': [{'type': 'text', 'text': 'first answer'}], 'api': 'faux-restart-a', 'provider': 'restart-a', 'model': 'one', 'usage': usage, 'stopReason': 'stop', 'timestamp': 0}},
        {'type': 'custom', 'customType': 'fixture-virtual-cwd', 'data': str(root / 'virtual-a')},
        {'type': 'message', 'message': {'role': 'user', 'content': 'second synthetic context ' + 'b' * 8000, 'timestamp': 0}},
        {'type': 'message', 'message': {'role': 'assistant', 'content': [{'type': 'text', 'text': 'second answer'}], 'api': 'faux-restart-a', 'provider': 'restart-a', 'model': 'one', 'usage': usage, 'stopReason': 'stop', 'timestamp': 0}},
        {'type': 'custom', 'customType': 'fixture-virtual-cwd', 'data': str(root / 'virtual-b')},
        {'type': 'session_info', 'name': root.name},
    ]
    serialized = [header] if empty else [header, *[
        {**entry, 'id': f'{index + 1:08x}', 'parentId': f'{index:08x}' if index else None, 'timestamp': '2026-09-07T12:00:00Z'}
        for index, entry in enumerate(entries)]]
    file.write_text(''.join(json.dumps(entry) + '\n' for entry in serialized))
    return file, sid


class OwnedPi:
    def __init__(self, options, root, runtime, late=False, key=True, empty=False, initial=False, ephemeral=False, unsaved=False, copy_node=False):
        self.root, self.runtime = root, runtime
        root.mkdir()
        for name in ('home', 'agent', 'tmp', 'xdg', 'native', 'override', 'launch', 'virtual-a', 'virtual-b'):
            (root / name).mkdir()
        self.file, self.sid = session_file(root, empty=empty)
        if unsaved:
            self.file.unlink()
        session_file(root, 'other.jsonl')
        (root / 'input.txt').write_text('synthetic initial file marker')
        settings = {'quietStartup': True, 'enableInstallTelemetry': False, 'lastChangelogVersion': options.version,
                    'defaultProjectTrust': 'never', 'defaultProvider': 'restart-a', 'defaultModel': 'one',
                    'compaction': {'enabled': False, 'reserveTokens': 1024, 'keepRecentTokens': 128},
                    'retry': {'enabled': True, 'baseDelayMs': 60000, 'maxRetries': 3}, 'theme': 'light'}
        (root / 'agent/settings.json').write_text(json.dumps(settings))
        self.key = 'synthetic-key-' + secrets.token_hex(16)
        self.marker = secrets.token_hex(16)
        node = options.node
        if copy_node:
            node = str(root / 'owned-node')
            shutil.copy2(options.node, node)
        self.node = node
        self.env = {
            'HOME': str(root / 'home'), 'PI_CODING_AGENT_DIR': str(root / 'agent'), 'TMPDIR': str(root / 'tmp'),
            'XDG_CONFIG_HOME': str(root / 'xdg'), 'XDG_CACHE_HOME': str(root / 'xdg'), 'XDG_DATA_HOME': str(root / 'xdg'),
            'XDG_STATE_HOME': str(root / 'xdg'), 'XDG_RUNTIME_DIR': str(root / 'xdg'),
            'PATH': f'{Path(options.node).parent}:/usr/bin:/bin', 'SHELL': '/bin/sh', 'TERM': 'xterm-256color', 'LANG': 'en_US.UTF-8',
            'PI_OFFLINE': '1', 'PI_TELEMETRY': '0', 'PI_SKIP_VERSION_CHECK': '1',
            'PI_RESTART_TEST_RUN': str(root), 'PI_RESTART_TEST_KEY': self.key, 'PI_RESTART_TEST_MARKER': self.marker,
            'PI_FITCH_RESTART_DIR': str(runtime),
        }
        (root / 'launch/fixture.ts').symlink_to(FIXTURE)
        if root.name.startswith('interceptor') or root.name == 'late-interceptor':
            self.env['PI_RESTART_TEST_INTERCEPT'] = {'interceptor-async': 'async', 'interceptor-result': 'result'}.get(root.name, 'operations')
        if root.name in ('input-dispatch', 'late-input-dispatch'):
            self.env['PI_RESTART_TEST_INPUT'] = '1'
        args = ['--offline', '--no-approve', '--no-skills', '--no-prompt-templates', '--no-themes', '--no-context-files', '--no-tools',
                '--extension', './fixture.ts', '--fixture-enabled', '--fixture-value=two words = retained', '--use-theme', 'light', '--thinking', 'low']
        if root.name in ('preserve', 'separator'):
            args += ['--system-prompt', '--', '--append-system-prompt', '--']
        if not late:
            args += ['--no-extensions', '--extension', str(HELPER)]
        if root.name == 'virtual':
            assert options.virtual_source, 'virtual case requires --virtual-source'
            args += ['--extension', str(options.virtual_source / 'index.ts')]
        if root.name in ('writer-dialog', 'writer-active'):
            args += ['--extension', str(REPO / 'extensions/write-prompt.ts')]
        if ephemeral:
            args += ['--no-session']
        else:
            args += ['--session', str(self.file)]
        args += ['--models', '*'] if late and key else ['--model', 'restart-a/one']
        if key:
            args += ['--api-key', self.key]
        if options.session_cwd and not ephemeral:
            args += ['--session-cwd', str(root / 'override')]
        if initial:
            args += ['@' + str(root / 'input.txt'), 'synthetic initial prompt marker']
        if root.name == 'separator':
            args += ['--', 'synthetic separator prompt', '--extension', 'must-not-replay.ts']
        command = [node, '--no-deprecation', '--stack-trace-limit=17', options.cli, *args]
        self.output = bytearray()
        self.code = None
        self.peers = []
        self.pid, self.master = pty.fork()
        if self.pid == 0:
            resource.setrlimit(resource.RLIMIT_CORE, (0, 0))
            os.chdir(root / 'launch')
            os.execve(command[0], command, self.env)
        fcntl.ioctl(self.master, termios.TIOCSWINSZ, struct.pack('HHHH', 36, 140, 0, 0))
        safe_command = ['[synthetic runtime key]' if value == self.key else value for value in command]
        (root / 'controller.jsonl').write_text(json.dumps({'event': 'owned-spawn', 'pid': self.pid, 'command': safe_command}) + '\n')
        self.socket = runtime / f'{self.pid}.sock'

    def poll(self):
        if select.select([self.master], [], [], 0.02)[0]:
            try:
                data = os.read(self.master, 65536)
            except OSError as error:
                if error.errno != errno.EIO:
                    raise
                data = b''
            if data:
                self.output.extend(data)
                with (self.root / 'pty.log').open('ab') as stream:
                    stream.write(data)
        if self.code is None:
            pid, status = os.waitpid(self.pid, os.WNOHANG)
            if pid:
                self.code = os.waitstatus_to_exitcode(status)
                with (self.root / 'controller.jsonl').open('a') as stream:
                    stream.write(json.dumps({'event': 'owned-reaped', 'pid': self.pid, 'code': self.code}) + '\n')

    def wait(self, predicate, label, timeout=25):
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            self.poll()
            for peer in self.peers:
                peer.poll()
            value = predicate()
            if value:
                return value
            if self.code is not None:
                raise AssertionError(f'{label}: exited {self.code}; {self.root}/pty.log')
        raise AssertionError(f'{label}: timed out; {self.root}/pty.log')

    def event(self, name, **fields):
        return self.wait(lambda: next((record for record in reversed(records(self.root)) if record['event'] == name and all(record.get(key) == value for key, value in fields.items())), None), name)

    def status(self):
        try:
            value = rpc(self.socket, {'version': 1, 'action': 'status'}, timeout=0.3)
            return value if value.get('version') == 1 else None
        except (OSError, EOFError):
            return None

    def ready(self, previous=None):
        return self.wait(lambda: (value if value and value['ready'] and (previous is None or value['instance'] != previous['instance']) else None) if (value := self.status()) else None, 'fresh ready')

    def screen(self, text, after=0):
        return self.wait(lambda: text.encode() in self.output[after:], text)

    def send(self, command):
        self.input((command + '\r').encode())

    def input(self, data):
        with (self.root / 'controller.jsonl').open('a') as stream:
            stream.write(json.dumps({'event': 'owned-input', 'pid': self.pid, 'data': data.decode(errors='replace')}) + '\n')
        os.write(self.master, data)

    def info(self, tag):
        self.send('/fixture-info ' + tag)
        return self.event('info', tag=tag)

    def restart(self, stop=False, previous=None):
        old = previous or self.ready()
        reply = rpc(self.socket, {'version': 1, 'action': 'restart', 'instance': old['instance'], 'file': old['file'], 'id': old['id'], 'stop': stop}, timeout=10)
        return old, reply

    def close(self):
        if self.code is None:
            os.kill(self.pid, signal.SIGTERM)
            deadline = time.monotonic() + 3
            while self.code is None and time.monotonic() < deadline:
                self.poll()
            if self.code is None:
                os.kill(self.pid, signal.SIGKILL)
                _, status = os.waitpid(self.pid, 0)
                self.code = os.waitstatus_to_exitcode(status)
                with (self.root / 'controller.jsonl').open('a') as stream:
                    stream.write(json.dumps({'event': 'owned-reaped-after-kill', 'pid': self.pid, 'code': self.code}) + '\n')
        os.close(self.master)


def assert_preserved(before, after):
    for key in ('id', 'file', 'cwd', 'nativeCwd', 'launchCwd', 'virtual', 'name', 'model', 'thinking', 'flags', 'trusted', 'nodeArgs', 'tty', 'envHash', 'aHasLaunchKey', 'bHasLaunchKey', 'dashPrompt', 'realVirtual'):
        assert after[key] == before[key], f'{key} changed: {before[key]!r} -> {after[key]!r}'
    assert before['pid'] == after['pid'] and before['image'] != after['image'] and after['raw'] is True
    assert after['bHasLaunchKey'] is False


def run_case(options, case, runtime):
    root = options.output / case
    child = OwnedPi(options, root, runtime, late=case.startswith('late'), key=case not in ('late-no-key', 'late-interceptor', 'late-input-dispatch'),
                    empty=case == 'late-key', initial=case in ('preserve', 'late-key'), ephemeral=case == 'ephemeral', unsaved=case == 'unsaved',
                    copy_node=case in ('preflight-failure', 'exec-failure'))
    writer_pid = None
    result = {'case': case, 'pid': child.pid, 'root': str(root)}
    try:
        child.event('resources')
        if case.startswith('late'):
            if case == 'late-input-dispatch':
                child.send('synthetic pending input handler')
                child.event('input-dispatch-start')
            if case == 'late-interceptor':
                child.send('!held work before helper activation')
                child.event('intercepted-bash-start')
            if case == 'late-key':
                child.event('settled')
                child.send('/fixture-model restart-b two high')
                child.event('changed')
            extensions = root / 'agent/extensions'
            extensions.mkdir()
            (extensions / 'restart.ts').symlink_to(HELPER)
            child.send('/reload')
            child.event('start', reason='reload')
        old = child.wait(lambda: (value if value and value.get('unavailable') else None) if (value := child.status()) else None, 'unsupported host') if case == 'unsupported' else child.ready()
        if case == 'unsupported':
            assert 'native Bash, input and nextTurn activity APIs' in old['unavailable'] and old['ready'] is False
            before = child.file.read_bytes()
            for stop in (False, True):
                _, reply = child.restart(stop, old)
                assert 'native Bash, input and nextTurn activity APIs' in reply['error']
                assert child.status()['instance'] == old['instance']
            assert child.file.read_bytes() == before
        elif case in ('ephemeral', 'unsaved', 'late-key'):
            assert old.get('unavailable'), old
            _, reply = child.restart(True, old)
            assert 'error' in reply and child.status()['instance'] == old['instance']
        elif case in ('input-dispatch', 'late-input-dispatch'):
            marker = 'synthetic pending input handler'
            if case == 'input-dispatch':
                child.send(marker)
            before = child.event('input-dispatch-start')
            result['nativeWhileInputAwaits'] = {key: before[key] for key in ('idle', 'pending', 'pendingInput', 'editor')}
            result['boundaryStatus'] = child.ready()
            assert marker not in child.file.read_text()
            _, reply = child.restart(False, old)
            result['defaultReply'] = reply
            if reply.get('accepted'):
                child.ready(old)
                result['defaultActuallyRestarted'] = True
                result['inputLost'] = marker not in child.file.read_text()
            assert 'error' in reply, 'Default restart must preserve submitted input awaiting native handlers'
            assert 'Busy:' in reply['error'] and child.status()['instance'] == old['instance']
            assert before['pendingInput'] == 1 and before['idle'] is True and before['pending'] is False and not before['editor']
            (root / 'release-input').write_text('release')
            assert child.event('fake-call')['pendingInputSeen'] is True
            child.event('settled')
            assert child.info('input-delivered')['pendingInput'] == 0
            result['inputDelivered'] = True
            (root / 'release-input').unlink()
            forced_marker = 'synthetic pending input explicitly stopped'
            child.send(forced_marker)
            child.wait(lambda: sum(row['event'] == 'input-dispatch-start' for row in records(root)) == 2, 'second held input')
            _, accepted = child.restart(True, old)
            assert accepted == {'accepted': True}, accepted
            child.ready(old)
            after = child.info('after-input-stop')
            assert_preserved(before, after)
            assert after['pendingInput'] == 0 and forced_marker not in child.file.read_text()
            result['explicitStopDiscardedPendingInput'] = True
        elif case == 'tree-queue':
            def queue_during_cancelled_summary(marker):
                child.send('/fixture-mode summary')
                child.wait(lambda: records(root)[-1]['event'] == 'mode-set', 'summary fixture mode')
                calls = sum(row['event'] == 'fake-call' and row['mode'] == 'summary' for row in records(root))
                start = len(child.output)
                child.send('/tree')
                child.screen('Session Tree', start)
                child.input(b'\x1b[D\r')
                child.screen('Summarize branch?', start)
                child.input(b'\x1b[B\r')
                child.wait(lambda: sum(row['event'] == 'fake-call' and row['mode'] == 'summary' for row in records(root)) > calls, 'branch summarizer started')
                child.send(marker)
                child.screen('Queued message for after compaction', start)
                start = len(child.output)
                child.input(b'\x1b')
                child.screen('Branch summarization cancelled', start)
                child.screen('Session Tree', start)
                child.input(b'\x1b')
                deadline = time.monotonic() + 0.5
                while time.monotonic() < deadline:
                    child.poll()
            marker = 'synthetic pending input queued during tree summary'
            queue_during_cancelled_summary(marker)
            before = child.info('after-tree-cancel')
            result['nativeAfterCancel'] = {key: before[key] for key in ('idle', 'pending', 'pendingInput', 'editor')}
            result['boundaryStatus'] = child.ready()
            assert marker not in child.file.read_text()
            _, reply = child.restart(False, old)
            result['defaultReply'] = reply
            if reply.get('accepted'):
                child.ready(old)
                result['defaultActuallyRestarted'] = True
                result['inputLost'] = marker not in child.file.read_text()
            assert 'error' in reply, 'Default restart must preserve native input retained after tree cancellation'
            assert 'Busy:' in reply['error'] and child.status()['instance'] == old['instance']
            assert before['pendingInput'] == 1 and before['idle'] is True and before['pending'] is False and not before['editor']
            child.send('/fixture-mode normal')
            child.wait(lambda: records(root)[-1].get('mode') == 'normal', 'normal fixture mode')
            start = len(child.output)
            child.input(b'\x1b[1;3A')
            child.screen('Restored 1 queued message to editor', start)
            child.screen(marker, start)
            assert 'Editor draft' in child.ready()['busy']
            child.input(b'\r')
            assert child.event('fake-call', mode='normal')['pendingInputSeen'] is True
            child.event('settled')
            assert child.info('tree-input-delivered')['pendingInput'] == 0
            result['inputDequeuedAndDelivered'] = True
            forced_marker = 'synthetic pending input tree explicitly stopped'
            queue_during_cancelled_summary(forced_marker)
            start = len(child.output)
            child.send('/restart all')
            child.screen('Restart selected sessions', start)
            child.input(b'\x1b[B\r')
            child.screen("Stop selected sessions' work?", start)
            child.input(b'\r')
            child.ready(old)
            after = child.info('after-tree-input-stop')
            assert_preserved(before, after)
            assert after['pendingInput'] == 0 and forced_marker not in child.file.read_text()
            result['confirmedStopDiscardedPendingInput'] = True
        elif case in ('interceptor', 'interceptor-async', 'interceptor-result', 'late-interceptor', 'nextturn'):
            if case.startswith('interceptor'):
                child.send('!held synthetic intercepted Bash')
                child.event('intercepted-bash-start' if case == 'interceptor' else 'intercepted-bash-dispatch')
            elif case == 'nextturn':
                child.send('/fixture-nextturn')
                child.event('nextturn-set')
            before = child.info('boundary-before')
            observed = child.ready()
            _, reply = child.restart(False, old)
            result['boundaryStatus'] = observed
            result['publicPending'] = before['pending']
            result['publicIdle'] = before['idle']
            result['defaultReply'] = reply
            if reply.get('accepted'):
                child.ready(old)
                result['defaultActuallyRestarted'] = True
                if case == 'nextturn':
                    child.send('synthetic prompt after restart')
                    call = child.event('fake-call')
                    result['nextTurnSurvived'] = call['nextTurnSeen']
            assert 'error' in reply, 'Default restart must not interrupt unobserved Bash or discard queued nextTurn context'
            assert child.status()['instance'] == old['instance']
            assert 'Busy:' in reply['error'] and observed['busy']
            if case == 'nextturn':
                assert before['nextTurn'] == 1 and before['pending'] is False
                child.send('synthetic prompt after refused restart')
                assert child.event('fake-call')['nextTurnSeen'] is True
                child.event('settled')
                result['nextTurnSurvived'] = True
                assert child.info('context-consumed')['nextTurn'] == 0
                child.send('/fixture-nextturn')
                child.wait(lambda: sum(row['event'] == 'nextturn-set' for row in records(root)) == 2, 'second queued context')
                child.wait(lambda: child.status()['busy'], 'queued context before explicit stop')
            else:
                assert before['bash'] is True
                if case == 'interceptor-result':
                    (root / 'release-interceptor').write_text('release')
                    child.wait(lambda: not child.status()['busy'], 'replacement result completed')
                    assert sum(row.get('message', {}).get('output') == 'Synthetic intercepted result' for row in map(json.loads, child.file.read_text().splitlines())) == 1
            _, accepted = child.restart(case != 'interceptor-result', old)
            assert accepted == {'accepted': True}, accepted
            child.ready(old)
            after = child.info('after-boundary-restart')
            assert after['id'] == before['id'] and after['file'] == before['file']
            assert after['bash'] is False and after['nextTurn'] == 0
            result['explicitStopOrCompletedRestart'] = True
        elif case == 'virtual':
            start = len(child.output)
            child.send('/cwd ' + str(root / 'virtual-a'))
            child.screen('Working directory: ' + str(root / 'virtual-a'), start)
            first = child.info('virtual-a')
            start = len(child.output)
            child.send('/cwd ' + str(root / 'virtual-b'))
            child.screen('Working directory: ' + str(root / 'virtual-b'), start)
            child.send('/fixture-tree ' + first['leaf'])
            child.event('tree')
            before = child.info('before-virtual-restart')
            old, accepted = child.restart()
            assert accepted == {'accepted': True}, accepted
            child.ready(old)
            after = child.info('after-virtual-restart')
            assert_preserved(before, after)
            assert after['realVirtual'] == {'dir': str(root / 'virtual-a')}
            output = root / 'actual-bash-cwd'
            child.send('!pwd > ' + shlex.quote(str(output)))
            child.wait(output.exists, 'real virtual cwd shell output')
            assert output.read_text().strip() == str(root / 'virtual-a')
            assert after['cwd'] == str(root / ('override' if options.session_cwd else 'native'))
            assert after['launchCwd'] == str(root / 'launch')
        elif case == 'separator':
            child.wait(lambda: len([row for row in records(root) if row['event'] == 'fake-call']) == 3 and not child.status()['busy'], 'all native separator inputs settled')
            old, accepted = child.restart()
            assert accepted == {'accepted': True}, accepted
            child.ready(old)
            assert len([row for row in records(root) if row['event'] == 'fake-call']) == 3
        elif case in ('preserve', 'reload', 'tree', 'root', 'late-no-key'):
            if case == 'preserve':
                child.event('settled')
                assert child.info('launch-key')['aHasLaunchKey'] is True, 'the fixture must actually resolve the one-run key, not compare two false values'
                child.send('/fixture-model restart-b two high')
                child.event('changed')
            if case == 'reload':
                child.send('/reload')
                child.event('start', reason='reload')
                assert child.ready()['instance'] == old['instance'], 'reload was mislabeled as a new process image'
            if case in ('tree', 'root'):
                child.send('/fixture-tree ' + ('00000005' if case == 'tree' else '00000001'))
                branch = child.event('tree')
                assert branch['leaf'] == ('00000005' if case == 'tree' else None)
            before = child.info('before')
            if case == 'late-no-key':
                assert not old['busy'], 'native activity is complete even on first helper activation'
            for index in range(2):
                old, accepted = child.restart()
                assert accepted == {'accepted': True}, accepted
                new = child.ready(old)
                assert new['id'] == old['id'] and new['file'] == old['file'] and new['restartedFrom'] == old['instance']
                after = child.info('after-' + str(index))
                assert_preserved(before, after)
                before = after
            if case == 'preserve':
                assert len([row for row in records(root) if row['event'] == 'fake-call']) == 1, 'initial input was replayed'
                assert before['aHasLaunchKey'] is True and before['bHasLaunchKey'] is False
                assert child.key not in child.file.read_text() and child.key not in json.dumps(new), 'one-run key leaked into saved/control state'
            if case in ('tree', 'root'):
                branch_entries = [row for row in map(json.loads, child.file.read_text().splitlines()) if row.get('customType') == 'session-restart']
                assert len(branch_entries) == 1 and 'data' not in branch_entries[0]
                assert ('00000006' not in after['branch']) and ('00000008' not in after['branch'])
        elif case in ('agent', 'retry', 'compact', 'summary', 'bash', 'draft', 'queue', 'writer-dialog', 'writer-active'):
            if case == 'bash':
                child.send('!exec ' + shlex.join([sys.executable, str(Path(__file__).resolve()), '--writer', str(root)]))
                child.wait(lambda: (root / 'writer.pid').exists() and (root / 'writer.log').exists(), 'owned writer')
                writer_pid = int((root / 'writer.pid').read_text())
            elif case.startswith('writer'):
                if case == 'writer-active':
                    child.send('/fixture-mode writer')
                    child.event('mode-set')
                child.send('/side-question synthetic off-transcript question')
                child.event('fake-call')
                if case == 'writer-dialog':
                    child.screen('Dismiss')
            elif case == 'draft':
                child.send('/fixture-draft')
                child.event('draft-set')
            else:
                child.send('/fixture-busy ' + ('tree' if case == 'summary' else 'agent' if case == 'queue' else case))
                child.event('fake-call')
                if case == 'queue':
                    child.send('/fixture-queue')
                    child.event('queue-set')
            child.wait(lambda: (value := child.status()) and value['busy'], 'busy status')
            _, refused = child.restart(False, old)
            assert 'Busy:' in refused['error'], refused
            assert child.status()['instance'] == old['instance']
            _, accepted = child.restart(True, old)
            assert accepted == {'accepted': True}, accepted
            child.ready(old)
            child.info('after-force')
            if writer_pid:
                try:
                    os.kill(writer_pid, 0)
                    raise AssertionError('owned shell writer survived restart')
                except ProcessLookupError:
                    pass
                size = (root / 'writer.log').stat().st_size
                child.info('writer-stopped')
                assert (root / 'writer.log').stat().st_size == size
        elif case == 'identity':
            child.send('/fixture-switch')
            child.event('start', reason='resume')
            new = child.ready()
            assert new['id'] != old['id'] and new['instance'] == old['instance']
            _, refused = child.restart(True, old)
            assert 'identity changed' in refused['error'], refused
        elif case == 'preflight-failure':
            Path(child.node).unlink()
            _, refused = child.restart(False, old)
            assert 'error' in refused and child.ready()['instance'] == old['instance']
        elif case in ('external-term', 'external-hup', 'second-term', 'second-hup', 'exec-failure', 'unexpected-zero', 'unexpected-nonzero'):
            child.send('/fixture-hold' + (' 0' if case == 'unexpected-zero' else ' 23' if case == 'unexpected-nonzero' else ''))
            child.event('hold-set')
            _, accepted = child.restart(case.startswith('second-'), old)
            assert accepted == {'accepted': True}, accepted
            if not case.startswith('unexpected-'):
                child.event('shutdown-held')
            if case == 'exec-failure':
                Path(child.node).unlink()
            elif not case.startswith('unexpected-'):
                os.kill(child.pid, signal.SIGHUP if case.endswith('hup') else signal.SIGTERM)
            (root / 'release').write_text('release')
            child.wait(lambda: child.code is not None, 'terminal exit')
            assert child.code == (-6 if case == 'exec-failure' else 23 if case == 'unexpected-nonzero' else 0), child.code
            assert len([row for row in records(root) if row['event'] == 'start']) == 1
        elif case == 'protocol':
            for payload in ({'version': 1, 'action': 'restart', 'executable': '/bin/sh'}, {'version': 1, 'action': 'status', 'env': {'secret': 'not-returned'}}):
                assert rpc(child.socket, payload) == {'error': 'Invalid helper request'}
            with socket.socket(socket.AF_UNIX) as connection:
                connection.connect(str(child.socket))
                connection.sendall(b'{bad-secret-json\n')
                assert b'bad-secret' not in connection.recv(4096)
            child.send('/fixture-hold')
            child.event('hold-set')
            _, accepted = child.restart(False, old)
            assert accepted == {'accepted': True}, accepted
            # The first restart has begun; a second cannot launch another replacement.
            try:
                _, second = child.restart(False, old)
                assert second.get('accepted') is not True
            except (OSError, EOFError):
                pass
            child.event('shutdown-held')
            (root / 'release').write_text('release')
            child.ready(old)
            assert len([row for row in records(root) if row['event'] == 'start']) == 2
        else:
            raise AssertionError('unknown case ' + case)
        if child.code is None:
            child.input(b'\x03')
            child.send('/quit')
            child.wait(lambda: child.code is not None, 'normal quit')
            assert child.code == 0
        assert not child.socket.exists(), 'control socket survived exit'
        result.update(passed=True, exitCode=child.code)
    except Exception as error:
        result.update(passed=False, error=repr(error))
        raise
    finally:
        child.close()
        if writer_pid:
            try:
                os.kill(writer_pid, 0)
            except ProcessLookupError:
                pass
            else:
                os.kill(writer_pid, signal.SIGKILL)
                result['writerNeededHarnessCleanup'] = True
        (root / 'result.json').write_text(json.dumps(result, indent=2) + '\n')
        print(json.dumps(result), flush=True)
    return result


def run_fleet(options, runtime):
    children = [OwnedPi(options, options.output / ('fleet-' + name), runtime) for name in ('a', 'b', 'c')]
    a, b, c = children
    for child in children:
        child.peers = [peer for peer in children if peer is not child]
    try:
        for child in children:
            child.event('resources')
        states = {child.pid: child.ready() for child in children}
        ordered = sorted(children, key=lambda child: child.pid)
        start = len(a.output)
        a.send('/restart')
        a.screen('Restart Pi sessions', start)
        a.input(b'\x1b[B' * (ordered.index(b) + 1) + b'\r')
        a.screen('Restart selected sessions', start)
        a.input(b'\r')
        states[b.pid] = b.ready(states[b.pid])
        a.wait(lambda: (value := a.status()) and not value['busy'], 'coordinator finished single selection')
        assert a.status()['instance'] == states[a.pid]['instance']
        assert c.status()['instance'] == states[c.pid]['instance']
        start = len(a.output)
        a.send('/restart')
        a.screen('Restart Pi sessions', start)
        position = 0
        for child in sorted((a, b), key=lambda child: child.pid):
            target = ordered.index(child) + 1
            a.input(b'\x1b[B' * (target - position) + b' ')
            position = target
        a.input(b'\r')
        a.screen('Restart selected sessions', start)
        a.input(b'\r')
        states[b.pid] = b.ready(states[b.pid])
        states[a.pid] = a.ready(states[a.pid])
        assert c.status()['instance'] == states[c.pid]['instance'], 'unselected peer was restarted'
        assert a.info('multi-after')['image'] > b.info('multi-after')['image'], 'initiator must restart last'
        c.send('/fixture-draft')
        c.event('draft-set')
        start = len(a.output)
        a.send('/restart all')
        a.screen('Restart selected sessions', start)
        a.input(b'\x1b[B\r')
        a.screen("Stop selected sessions' work?", start)
        a.input(b'\r')  # Native confirm options are Yes, No.
        for child in (b, c, a):
            states[child.pid] = child.ready(states[child.pid])
        assert not c.status()['busy'], 'explicit stop should discard the selected peer draft'
        result = {'case': 'fleet', 'passed': True, 'pids': [child.pid for child in children], 'singleMultipleAll': True, 'unselectedPreserved': True, 'initiatorLast': True}
        print(json.dumps(result), flush=True)
        return result
    finally:
        for child in children:
            child.close()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--runtime-dir', type=Path, required=True)
    parser.add_argument('--node', default=shutil.which('node'))
    parser.add_argument('--pi-root', type=Path, default=REPO / 'node_modules/@earendil-works/pi-coding-agent')
    parser.add_argument('--session-cwd', action='store_true')
    parser.add_argument('--virtual-source', type=Path)
    parser.add_argument('--cases', default='preserve,reload,tree,root,late-no-key,late-key,ephemeral,unsaved,agent,retry,compact,summary,bash,draft,queue,writer-dialog,writer-active,identity,preflight-failure,external-term,external-hup,second-term,second-hup,unexpected-zero,unexpected-nonzero,exec-failure,protocol,fleet,interceptor,interceptor-async,interceptor-result,late-interceptor,nextturn,tree-queue,input-dispatch,late-input-dispatch')
    options = parser.parse_args()
    package = json.loads((options.pi_root / 'package.json').read_text())
    options.version = package['version']
    options.cli = str(options.pi_root / package['bin']['pi'])
    options.output.mkdir(parents=True)
    options.runtime_dir.mkdir(mode=0o700)
    results = [run_fleet(options, options.runtime_dir) if case == 'fleet' else run_case(options, case, options.runtime_dir) for case in options.cases.split(',')]
    (options.output / 'results.json').write_text(json.dumps(results, indent=2) + '\n')
    print(f'PASS: {len(results)} real Pi {options.version} PTY cases; all owned Pi processes reaped')


if __name__ == '__main__':
    if len(sys.argv) == 3 and sys.argv[1] == '--writer':
        root = Path(sys.argv[2])
        (root / 'writer.pid').write_text(str(os.getpid()))
        with (root / 'writer.log').open('a', buffering=1) as output:
            while True:
                output.write('tick\n')
                time.sleep(0.02)
    else:
        main()

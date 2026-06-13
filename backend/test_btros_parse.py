"""Offline checks for the Groot2 v4 parser + protocol framing.

Run: python3 test_btros_parse.py
(No live executor needed — exercises the XML→blueprint transform and the
byte-level request/status codecs against a synthetic v4 tree.)
"""
import struct

from ros_monitor_bridge.btros_bridge import (
    REQ_FULLTREE,
    build_request,
    parse_status_payload,
    parse_tree_xml,
)

SAMPLE_XML = """
<root BTCPP_format="4" main_tree_to_execute="MainTree">
  <BehaviorTree ID="MainTree" _fullpath="MainTree">
    <Sequence _uid="1">
      <Condition ID="IsBatteryOk" _uid="2" min_level="{battery_min}"/>
      <RetryUntilSuccessful _uid="3" num_attempts="3">
        <Action ID="MoveBase" _uid="4" goal="{target}" result="{nav_result}"/>
      </RetryUntilSuccessful>
      <SubTree ID="Recover" _uid="5"/>
    </Sequence>
  </BehaviorTree>
  <BehaviorTree ID="Recover" _fullpath="Recover">
    <Fallback _uid="6">
      <Action ID="Wait" _uid="7" msec="1000"/>
    </Fallback>
  </BehaviorTree>
  <TreeNodesModel>
    <Condition ID="IsBatteryOk"><input_port name="min_level"/></Condition>
    <Action ID="MoveBase"><input_port name="goal"/><output_port name="result"/></Action>
    <Action ID="Wait"><input_port name="msec"/></Action>
  </TreeNodesModel>
</root>
"""


def test_parse_tree():
    bp = parse_tree_xml(SAMPLE_XML)
    assert bp['tree_id'] == 'MainTree', bp['tree_id']
    assert bp['root_id'] == 1, bp['root_id']
    by_id = {n['id']: n for n in bp['nodes']}

    seq = by_id[1]
    assert seq['category'] == 'control' and seq['type'] == 'Sequence'
    # Decorator (uid 3) folds into MoveBase (uid 4); SubTree is uid 5.
    assert seq['children'] == [2, 4, 5], seq['children']

    cond = by_id[2]
    assert cond['category'] == 'condition'
    assert cond['ports'] == {'input': {'min_level': '{battery_min}'}}, cond['ports']

    move = by_id[4]
    assert move['category'] == 'action' and move['type'] == 'MoveBase'
    assert [d['type'] for d in move['decorators']] == ['RetryUntilSuccessful'], move['decorators']
    assert move['decorators'][0]['id'] == 3
    assert move['ports']['input'] == {'goal': '{target}'}, move['ports']
    assert move['ports']['output'] == {'result': '{nav_result}'}, move['ports']

    sub = by_id[5]
    assert sub['category'] == 'subtree' and sub['children'] == [6], sub
    assert by_id[6]['type'] == 'Fallback'
    assert by_id[7]['type'] == 'Wait'

    # Every node has the full contract shape.
    for n in bp['nodes']:
        assert set(n) >= {'id', 'name', 'type', 'category', 'children', 'decorators', 'services', 'ports'}
    print('  parse_tree OK —', len(bp['nodes']), 'nodes')


def test_request_framing():
    req = build_request(REQ_FULLTREE, 0x01020304)
    assert req == bytes([PROTOCOL := 2, ord('T'), 0x04, 0x03, 0x02, 0x01]), req
    assert len(req) == 6
    print('  request framing OK —', req.hex())


def test_status_decode():
    payload = struct.pack('<HB', 1, 1) + struct.pack('<HB', 4, 2) + struct.pack('<HB', 6, 3)
    status = parse_status_payload(payload)
    assert status == {1: 'RUNNING', 4: 'SUCCESS', 6: 'FAILURE'}, status
    print('  status decode OK —', status)


if __name__ == '__main__':
    test_parse_tree()
    test_request_framing()
    test_status_decode()
    print('ALL BTROS PARSE TESTS PASSED')

import json
import requests
import random
import re

from redash.utils import JSONEncoder
from redash.query_runner import *

import logging
logger = logging.getLogger(__name__)

# Prereqirements and installation on a clean re:dash instance:
# sudo pip2.7 install pydrill
# sudo pip2.7 install kazoo
# sudo pip2.7 install protobuf
# Copy drill.py and drill_coordination.py to /opt/redash/current/redash/query_runner/
# Run
# sudo supervisorctl restart all

# Compiling Drill coordination proto from the drill root path:
# protoc --proto_path=protocol/src/main/protobuf --python_out=/tmp Coordination.proto

try:
    from pydrill.client import PyDrill
    from pydrill.connection.requests_conn import RequestsHttpConnection
    from pydrill.transport import TransportError
    from kazoo.client import KazooClient
    import drill_coordination as coordination
    enabled = True

    class DrillRequestsHttpConnection(RequestsHttpConnection):
        def __init__(self, host='localhost', port=8047, **kwargs):
            super(DrillRequestsHttpConnection, self).__init__(
                host=host, port=port, http_auth=None, use_ssl=False,
                verify_certs=False, ca_certs=None, client_cert=None, **kwargs)
            self.session = kwargs['drill_session']

except ImportError:
    logger.error('Drill import error')
    enabled = False


class Drill(BaseQueryRunner):
    @classmethod
    def configuration_schema(cls):
        return {
            'type': 'object',
            'properties': {
                'host': {
                    'type': 'string'
                },
                'port': {
                    'type': 'number'
                },
                'is_zookeeper': {
                    'type': 'string'
                },
                'user_auth': {
                    'type': 'string'
                }
            },
            'required': ['host']
        }

    @classmethod
    def enabled(cls):
        return enabled

    @classmethod
    def name(cls):
        return "Apache Drill"

    @classmethod
    def type(cls):
        return "drill"

    def __init__(self, configuration):
        logger.info('config: ' + str(configuration))
        super(Drill, self).__init__(configuration)

    def get_drillbit(self, host, port, is_zookeeper):
        if is_zookeeper:
            if not port:
                port = 2181
            zk = KazooClient(hosts='{0}:{1}'.format(host, port))
            zk.start()
            children = zk.get_children("/drill/karhoodatadrill1")
            znode = children[random.randint(0, len(children) - 1)]
            data, stat = zk.get("/drill/karhoodatadrill1/" + znode)
            zk.stop()
            dsi = coordination.DrillServiceInstance()
            dsi.ParseFromString(data)
            return (dsi.endpoint.address, 8047)
        if not port:
            port = 8047
        return (host, port)

    def auth_drill(self, session, host, port, user, password):
        url = 'http://{0}:{1}/j_security_check'.format(host, port)
        login = {'j_username': user, 'j_password': password}
        r = session.post(url, data=login, verify=False)
        if r.status_code == 200:
            if r.text.find("Invalid username/password credentials") >= 0:
                print("Authentication Failed - Please check Secrets - Exiting")
                return False
            elif r.text.find("Number of Drill Bits") >= 0:
                print("Authentication successful")
                return True
            print("Unknown Response Code 200\n{0}".format(r.text))
            return False
        print("HTTP Code: {0}\n{1}".format(r.status_code, r.text))
        return False

    def strip_comments(self, text):
        result = []
        for line in re.sub('/\*([^*]|[\r\n]|(\*+([^*/]|[\r\n])))*\*+/', '', text, re.S).split('\n'):
            if line.startswith('#') or line.startswith('--'):
                continue
            result.append(line)
        return '\n'.join(result)


    def run_query(self, query):
        drillbit_host, drillbit_port = self.get_drillbit(
            self.configuration.get('host', None),
            self.configuration.get('port', None),
            json.loads(self.configuration.get('is_zookeeper', "false").lower()))

        user_auth = self.configuration.get('user_auth', None)
        if user_auth:
            session = requests.Session()  # Create a session object
            username, password = user_auth.split(':')
            if not self.auth_drill(session, drillbit_host, drillbit_port,
                                  username, password):
                json_data = None
                error = 'Invalid credentials for Drill'
                return json_data, error
            connection = PyDrill(host=drillbit_host, port=drillbit_port,
                                 connection_class=DrillRequestsHttpConnection,
                                 drill_session=session)
        else:
            connection = PyDrill(host=drillbit_host, port=drillbit_port)

        if not connection.is_active():
            json_data = None
            error = 'Please run Drill first'
            return json_data, error

        try:
            result = None
            for q in self.strip_comments(query).split(';'):
                q = q.strip()
                if not q:
                    continue
                result = connection.query(q, timeout=600)
                print(result.rows)
                logger.info(result.rows)
            columns = []
            for col in result.columns:
                columns.append({'name': col,
                                'friendly_name': col,
                                'type': TYPE_STRING})
            rows = result.rows
            data = {'columns': columns, 'rows': rows}
            json_data = json.dumps(data, cls=JSONEncoder)
            error = None
        except TransportError as te:
            json_data = None
            error = te.error
        except Exception as ex:
            json_data = None
            error = str(ex)

        return json_data, error

register(Drill)

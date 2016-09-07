from tests import BaseTestCase
from redash.utils.configuration import ConfigurationContainer
from redash.query_runner.drill import Drill

config = ConfigurationContainer(
    {
        'host': 'zookeeper1.karhoo.data',
        'is_zookeeper': 'true'
    },
    Drill.configuration_schema()
)

sql0 = '''
SELECT td,
       supplier,
       count(reg_nr)
FROM
  (SELECT td,
          supplier,
          reg_nr
   FROM
     (SELECT substr(cast(ts AS varchar), 1, 10) AS td,
             cast(supplier_id AS varchar) AS supplier,
             cast(COALESCE(aal.additional_info_dict.vehicle__registration_number, aal.additional_info_dict.vehicle__supplier_vehicle_id) AS varchar) AS reg_nr
      FROM s3dp.aal.aal20160720 aal
      WHERE resource_type = 'availability')
   WHERE td = '2016-07-20'
   GROUP BY td,
            supplier,
            reg_nr)
GROUP BY td,
         supplier
ORDER BY td
limit 10
'''

sql1 = 'select * from s3raw.aaldaily.`2016/08/09/*` limit 5'

sql3 = '''
SELECT substr(date_created, 1, 10) AS date_created,
       count(*) AS trip_count
FROM s3dp.tmp.trips20160815
WHERE STATE = 13
  AND date_created >= '2016-05-01'
  AND date_scheduled = 'NULL'
GROUP BY substr(date_created, 1, 10)
ORDER BY date_created
'''

#alter session set `store.format`='json';
sql4 = '''
alter system set `store.format`='json';
create table s3dpw.tmp.jtest5 as select ts, uuid from s3raw.aalraw.`2016/08/24/12/*` limit 5
'''

sql5 = '''
select ts, uuid from s3raw.aalraw.`2016/08/24/12/*` limit 5
'''

sql6 = '''
SELECT abc FROM/*
comment1 ; * -- # */
mytable where
#comment2
a=1 and
-- comment3
b=2;
/*** comment4 */
select a from b;
'''

sql6x = '''
SELECT abc FROM
mytable where
a=1 and
b=2;

select a from b;
'''

sql7 = '''/* annotation1 */
select ts, uuid from s3raw.aalraw.`2016/08/24/12/*` limit 5
'''

sql8 = '''/* annotation2 */ select * from s3test.tmp.test01;
'''

sql = sql5

class TestDrill(BaseTestCase):
    def runTest(self):
        drill = Drill(config)
        print(drill.get_drillbit('zookeeper1.karhoo.data', None, True))
        print(drill.run_query(sql))

    def runTestLocal(self):
        config = ConfigurationContainer(
            {
                'host': 'localhost',
                'is_zookeeper': 'false',
                'user_auth': 'moritz.neun@karhoo.com:kabc'
            },
            Drill.configuration_schema()
        )
        print(config)
        drill = Drill(config)
        print(drill)

        print(drill.get_annotation(sql7))
        print(drill.get_annotation(sql8))
        print(drill.run_query(sql8))
        return

        assert (drill.strip_comments(sql0) == sql0)
        assert (drill.strip_comments(sql1) == sql1)
        assert (drill.strip_comments(sql3) == sql3)
        assert (drill.strip_comments(sql4) == sql4)
        assert (drill.strip_comments(sql5) == sql5)
        sql6stripped = drill.strip_comments(sql6)
        assert (sql6stripped == sql6x)
        assert (len(sql6stripped.split(';')) == 3)

        #print(drill.run_query('select * from dfs.tmp.`aal_raw_test.json` limit 2'))
        print(drill.run_query('select * from s3test.tmp.test01;'))
        return
        print(drill.run_query('create table dfs.tmp.tp11 as select * from dfs.tmp.`aal_raw_test.json` limit 2'))
        print(drill.run_query(
            '''
               alter session set `store.format`='json';
               create table dfs.tmp.tp12 as select * from dfs.tmp.`aal_raw_test.json` limit 2;
            '''
        ))
        print(drill.run_query('create table dfs.tmp.tp13 as select * from dfs.tmp.`aal_raw_test.json` limit 2'))


t = TestDrill()
#t.runTest()
t.runTestLocal()
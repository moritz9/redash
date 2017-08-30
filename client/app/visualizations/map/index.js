import _ from 'lodash';
import d3 from 'd3';
import L from 'leaflet';
import 'leaflet.markercluster';
import 'leaflet/dist/leaflet.css';
import 'leaflet.markercluster/dist/MarkerCluster.css';
import 'leaflet.markercluster/dist/MarkerCluster.Default.css';
import markerIcon from 'leaflet/dist/images/marker-icon.png';
import markerIconRetina from 'leaflet/dist/images/marker-icon-2x.png';
import markerShadow from 'leaflet/dist/images/marker-shadow.png';
import 'leaflet-fullscreen';
import 'leaflet-fullscreen/dist/leaflet.fullscreen.css';

import template from './map.html';
import editorTemplate from './map-editor.html';
import * as s2lib from './s2geometry';

/*
This is a workaround for an issue with giving Leaflet load the icon on its own.
*/
L.Icon.Default.mergeOptions({
  iconUrl: markerIcon,
  iconRetinaUrl: markerIconRetina,
  shadowUrl: markerShadow,
});

delete L.Icon.Default.prototype._getIconUrl;

/*
This is a workaround for the naming equivalence in S2.
*/
const S2 = s2lib.S2;


function mapRenderer() {
  return {
    restrict: 'E',
    template,
    link($scope, elm) {
      const colorScale = d3.scale.category10();
      const map = L.map(elm[0].children[0].children[0], {
        scrollWheelZoom: false,
        fullscreenControl: true,
      });
      const mapControls = L.control.layers().addTo(map);
      const layers = {};
      /*const tileLayer = L.tileLayer('//{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; <a href="http://osm.org/copyright">OpenStreetMap</a> contributors',
      }).addTo(map);*/
      const tileLayer = L.tileLayer('https://{s}.{base}.maps.cit.api.here.com/maptile/2.1/{type}/{mapID}/{scheme}/{z}/{x}/{y}/{size}/{format}?app_id={app_id}&app_code={app_code}&lg={language}', {
        attribution: 'Map &copy; 2016 <a href="http://developer.here.com">HERE</a>',
        subdomains: '1234',
        base: 'base',
        type: 'maptile',
        scheme: 'pedestrian.day',
        app_id: 'insteteyA3hufe5uqu2A',
        app_code: '6Rlm-5iBHtLExKbPJEG-OA',
        mapID: 'newest',
        maxZoom: 20,
        language: 'eng',
        format: 'png8',
        size: '256'
      }).addTo(map);

      function getBounds() {
        $scope.visualization.options.bounds = map.getBounds();
      }

      function setBounds() {
        const b = $scope.visualization.options.bounds;

        if (b) {
          map.fitBounds([[b._southWest.lat, b._southWest.lng],
            [b._northEast.lat, b._northEast.lng]]);
        } else if (layers) {
          const allMarkers = _.flatten(_.map(_.values(layers), l => l.getLayers()));
          // eslint-disable-next-line new-cap
          const group = new L.featureGroup(allMarkers);
          map.fitBounds(group.getBounds());
        }
      }


      map.on('focus', () => { map.on('moveend', getBounds); });
      map.on('blur', () => { map.off('moveend', getBounds); });

      function resize() {
        if (!map) return;
        map.invalidateSize(false);
        setBounds();
      }

      const createMarker = (lat, lon) => L.marker([lat, lon]);

      const heatpoint = (lat, lon, color) => {
        const style = {
          fillColor: color,
          fillOpacity: 0.9,
          stroke: false,
        };

        return L.circleMarker([lat, lon], style);
      };

      function createDescription(latCol, lonCol, row) {
        const lat = row[latCol];
        const lon = row[lonCol];

        let description = '<ul style="list-style-type: none;padding-left: 0">';
        description += `<li><strong>${lat}, ${lon}</strong>`;

        _.each(row, (v, k) => {
          if (!(k === latCol || k === lonCol)) {
            description += `<li>${k}: ${v}</li>`;
          }
        });

        return description;
      }

      function getColor(d) {
        return d < 50  ? '#ffffb2' :
               d < 100  ? '#fecc5c' :
               d < 150  ? '#fd8d3c' :
               d < 200  ? '#f03b20' :
                          '#bd0026';
      }

      function createPolygon(geojson, color) {
        //var latlngs = [[37, -109.05],[41, -109.03],[41, -102.05],[37, -102.04]];
        var listObj = JSON.parse(geojson);
        var latlngs = [];
        for (var i = 0; i < listObj[0].length; i++) {
          latlngs.push([listObj[0][i][1], listObj[0][i][0]])
        }
        console.log(latlngs);
        return L.polygon(latlngs, {color: color, weight: 1, fillOpacity: 0.7});
      }

      function removeLayer(layer) {
        if (layer) {
          mapControls.removeLayer(layer);
          map.removeLayer(layer);
        }
      }

      function addLayer(name, points) {
        const latCol = $scope.visualization.options.latColName || 'lat';
        const lonCol = $scope.visualization.options.lonColName || 'lon';
        const geomCol = $scope.visualization.options.geomColName || 'geojson';
        const valueCol = $scope.visualization.options.valueColName || 'value';
        const classify = $scope.visualization.options.classify;

        let markers;
        if ($scope.visualization.options.clusterMarkers) {
          const color = $scope.visualization.options.groups[name].color;
          const options = {};

          if (classify) {
            options.iconCreateFunction = (cluster) => {
              const childCount = cluster.getChildCount();

              let c = ' marker-cluster-';
              if (childCount < 10) {
                c += 'small';
              } else if (childCount < 100) {
                c += 'medium';
              } else {
                c += 'large';
              }

              c = '';

              const style = `color: white; background-color: ${color};`;
              return L.divIcon({ html: `<div style="${style}"><span>${childCount}</span></div>`, className: `marker-cluster${c}`, iconSize: new L.Point(40, 40) });
            };
          }

          markers = L.markerClusterGroup(options);
        } else {
          markers = L.layerGroup();
        }

        // create markers
        _.each(points, (row) => {
          let marker;

          const lat = row[latCol];
          const lon = row[lonCol];
          const geojson = row[geomCol];

          if ((lat === null || lon === null) && geojson === null) return;

          if (classify && classify !== 'none') {
            const groupColor = $scope.visualization.options.groups[name].color;
            marker = heatpoint(lat, lon, groupColor);
          } else if (geojson && geojson !== 'none') {
            //var polygon = createPolygon(geojson);
            //polygon.addTo(map);
            const value = row[valueCol] || 0;
            const color = getColor(value);
            marker = createPolygon(geojson, color);
            //marker = createMarker(lat, lon);
          } else {
            marker = createMarker(lat, lon);
          }

          marker.bindPopup(createDescription(latCol, lonCol, row));
          markers.addLayer(marker);
        });

        markers.addTo(map);

        layers[name] = markers;
        mapControls.addOverlay(markers, name);
      }

      function render() {
        const queryData = $scope.queryResult.getData();
        const classify = $scope.visualization.options.classify;

        //$scope.visualization.options.mapTileUrl = $scope.visualization.options.mapTileUrl || '//{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';
        //tileLayer.setUrl($scope.visualization.options.mapTileUrl);

        if ($scope.visualization.options.clusterMarkers === undefined) {
          $scope.visualization.options.clusterMarkers = true;
        }

        if (queryData) {
          let pointGroups;
          if (classify && classify !== 'none') {
            pointGroups = _.groupBy(queryData, classify);
          } else {
            pointGroups = { All: queryData };
          }

          const groupNames = _.keys(pointGroups);
          const options = _.map(groupNames, (group) => {
            if ($scope.visualization.options.groups && $scope.visualization.options.groups[group]) {
              return $scope.visualization.options.groups[group];
            }
            return { color: colorScale(group) };
          });

          $scope.visualization.options.groups = _.zipObject(groupNames, options);

          _.each(layers, (v) => {
            removeLayer(v);
          });

          _.each(pointGroups, (v, k) => {
            addLayer(k, v);
          });

          setBounds();
        }
      }

      $scope.handleResize = () => {
        resize();
      };

      $scope.$watch('queryResult && queryResult.getData()', render);
      $scope.$watch('visualization.options', render, true);
    },
  };
}

function mapEditor() {
  return {
    restrict: 'E',
    template: editorTemplate,
    link($scope) {
      $scope.currentTab = 'general';
      $scope.columns = $scope.queryResult.getColumns();
      $scope.columnNames = _.map($scope.columns, i => i.name);
      $scope.classify_columns = $scope.columnNames.concat('none');
      $scope.mapTiles = [
        {
          name: 'OpenStreetMap',
          url: '//{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
        },
        {
          name: 'OpenStreetMap BW',
          url: '//{s}.tiles.wmflabs.org/bw-mapnik/{z}/{x}/{y}.png',
        },
        {
          name: 'OpenStreetMap DE',
          url: '//{s}.tile.openstreetmap.de/tiles/osmde/{z}/{x}/{y}.png',
        },
        {
          name: 'OpenStreetMap FR',
          url: '//{s}.tile.openstreetmap.fr/osmfr/{z}/{x}/{y}.png',
        },
        {
          name: 'OpenStreetMap Hot',
          url: '//{s}.tile.openstreetmap.fr/hot/{z}/{x}/{y}.png',
        },
        {
          name: 'Thunderforest',
          url: '//{s}.tile.thunderforest.com/cycle/{z}/{x}/{y}.png',
        },
        {
          name: 'Thunderforest Spinal',
          url: '//{s}.tile.thunderforest.com/spinal-map/{z}/{x}/{y}.png',
        },
        {
          name: 'OpenMapSurfer',
          url: '//korona.geog.uni-heidelberg.de/tiles/roads/x={x}&y={y}&z={z}',
        },
        {
          name: 'Stamen Toner',
          url: '//stamen-tiles-{s}.a.ssl.fastly.net/toner/{z}/{x}/{y}.png',
        },
        {
          name: 'Stamen Toner Background',
          url: '//stamen-tiles-{s}.a.ssl.fastly.net/toner-background/{z}/{x}/{y}.png',
        },
        {
          name: 'Stamen Toner Lite',
          url: '//stamen-tiles-{s}.a.ssl.fastly.net/toner-lite/{z}/{x}/{y}.png',
        },
        {
          name: 'OpenTopoMap',
          url: '//{s}.tile.opentopomap.org/{z}/{x}/{y}.png',
        },
      ];
    },
  };
}

export default function init(ngModule) {
  ngModule.directive('mapRenderer', mapRenderer);
  ngModule.directive('mapEditor', mapEditor);
  ngModule.config((VisualizationProvider) => {
    const renderTemplate =
      '<map-renderer ' +
      'options="visualization.options" query-result="queryResult">' +
      '</map-renderer>';

    const editTemplate = '<map-editor></map-editor>';
    const defaultOptions = {
      defaultColumns: 3,
      defaultRows: 8,
      minColumns: 2,
      classify: 'none',
      clusterMarkers: true,
    };

    VisualizationProvider.registerVisualization({
      type: 'MAP',
      name: 'Map (Markers)',
      renderTemplate,
      editorTemplate: editTemplate,
      defaultOptions,
    });
  });
}

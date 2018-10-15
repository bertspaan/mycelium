const fs = require('fs')
const path = require('path')
const got = require('got')
const turf = require('@turf/turf')
const R = require('ramda')
const argv = require('minimist')(process.argv.slice(2), {
  alias: {
    o: 'output'
  }
})

const bufferSize = 1200 // meters
const numRandomPoints = 8
const numRandomLines = 10
const bufferSteps = 10 // see http://turfjs.org/docs#buffer
const sleepMs = 700 // sleep between Mapbox requests, in ms
const simplificationOptions = {
  tolerance: 0.0001,
  highQuality: true
}

const name = path.basename(__filename)

if (process.stdin.isTTY && !argv._[0]) {
  return console.error(`Usage: ${name} [-o file] FILE\n` +
    `  -o, --output   Path to output file, if not given, ${name} uses stdout`)
}

// Read GeoJSON file from command line argument
const geojsonPath = argv._[0]
const geojson = JSON.parse(fs.readFileSync(geojsonPath, 'utf8'))

if (!geojson.features.length) {
  console.error(`Input file should be GeoJSON FeatureCollection 😡!!!`)
  process.exit(1)
}

if (!process.env.MAPBOX_DIRECTIONS) {
  console.error(`Environment variable MAPBOX_DIRECTIONS not set 😡!!! This variable should contain your Mapbox Directions API token!`)
  process.exit(1)
}

const accessToken = process.env.MAPBOX_DIRECTIONS

function routesToPointOnBuffer (feature, buffered) {
  return turf.coordAll(buffered).map((pointOnBuffer) => {
    let point
    if (feature.geometry.type === 'Point') {
      point = feature.geometry.coordinates
    } else if (feature.geometry.type === 'LineString') {
      // TODO: test this!
      point = turf.nearestPointOnLine(feature.geometry, pointOnBuffer).geometry.coordinates
    }

    const line = turf.lineString([point, pointOnBuffer])
    const to = turf.along(line, Math.max(10, Math.random() * bufferSize) / 1000, {
      units: 'kilometers'
    }).geometry.coordinates

    return [point, to]
  })
}

function routesBetweenRandomPointsInBuffer (buffered) {
  return turf.randomPoint(numRandomLines * 2, {
    bbox: turf.bbox(buffered)
  }).features
    .reduce((result, value, index, array) => {
      if (index % 2 === 0) {
        result.push(array.slice(index, index + 2))
      }
      return result
    }, [])
    .map((points) => ([
      points[0].geometry.coordinates,
      points[1].geometry.coordinates
    ]))
}

function routesToRandomPointsInBuffer (feature, buffered) {
  return turf.randomPoint(numRandomPoints, {
    bbox: turf.bbox(buffered)
  }).features
    .map((randomPoint) => {
      let point
      if (feature.geometry.type === 'Point') {
        point = feature.geometry.coordinates
      } else if (feature.geometry.type === 'LineString') {
        // TODO: test this!
        point = turf.nearestPointOnLine(feature.geometry, randomPoint).geometry.coordinates
      }

      return [point, randomPoint.geometry.coordinates]
    })
}

function lineStringFeatureWithProperties (feature, points) {
  return {
    type: 'Feature',
    properties: {
      ...feature.properties,
      routeOrigin: feature.geometry
    },
    geometry: {
      type: 'LineString',
      coordinates: points
    }
  }
}

const lines = R.flatten(geojson.features.map((feature) => {
  const bufferedAll = turf.buffer(feature, bufferSize / 1000, {
    units: 'kilometers',
    steps: bufferSteps
  })

  const ratio = Math.floor(bufferedAll.geometry.coordinates[0].length / bufferSteps)

  const buffered = {
    ...bufferedAll,
    geometry: {
      type: 'Polygon',
      coordinates: [
        bufferedAll.geometry.coordinates[0]
          .filter((_, index, ar) => {
            return (index % ratio === 0);
          })
      ]
    }
  }

  return [
    ...routesToPointOnBuffer(feature, buffered),
    ...routesBetweenRandomPointsInBuffer(buffered),
    ...routesToRandomPointsInBuffer(feature, buffered)
  ].map(R.curry(lineStringFeatureWithProperties)(feature))
}))

const getDirectionsUrl = (from, to) => `https://api.mapbox.com/directions/v5/mapbox/walking/${from.join(',')};${to.join(',')}?steps=false&alternatives=true&access_token=${accessToken}&geometries=geojson`
const getRoutesFromResponse = (response) => response.body.routes.map((route) => route.geometry)[0]
const fetchUrl = async (from, to) => got(getDirectionsUrl(from, to), {
  json: true
})

const routes = []

function computeAllRoutes(lines, sleep) {
  return lines.reduce((promise, line, index) => {
    return promise
      .then((result) => {
        console.error(`Computing route ${index + 1}/${lines.length} (sleeping ${sleep}ms)`)
        const points = line.geometry.coordinates

        return fetchUrl(points[0], points[1])
          .then((response) => new Promise((resolve, reject) => {
            setTimeout(() => resolve(response), sleep)
          }))
          .then((response) => {
            routes.push({
              type: 'Feature',
              properties: line.properties,
              geometry: turf.simplify(getRoutesFromResponse(response),
                simplificationOptions)
            })
          })
      })
      .catch(console.error)
  }, Promise.resolve())
}

computeAllRoutes(lines, sleepMs)
  .then(() => {
    console.log(JSON.stringify({
      type: 'FeatureCollection',
      features: routes
    }, null, 2))
  })

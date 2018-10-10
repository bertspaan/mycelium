const fs = require('fs')
const path = require('path')
const turf = require('@turf/turf')
const R = require('ramda')
const argv = require('minimist')(process.argv.slice(2), {
  alias: {
    o: 'output'
  }
})

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

const features = []

turf.featureEach(geojson, (feature) => {
  turf.segmentEach(feature, (segment) => {
    const origin = feature.properties.routeOrigin
    const distance = Math.round(turf.pointToLineDistance(origin, segment, {
      units: 'kilometers'
    }) * 1000)

    features.push({
      type: 'Feature',
      properties: {
        distance,
        title: feature.properties.title
      },
      geometry: segment.geometry
    })
  })
})

console.log(JSON.stringify({
  type: 'FeatureCollection',
  features
}, null, 2))

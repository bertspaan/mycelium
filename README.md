# Mycelium Street Networks

First use Mapbox Directions to compute routes from each location in [`locations.geojson`](geojson/locations.geojson):

    node mycelium.js geojson/locations.geojson > geojson/mycelium.geojson

Then, segmentize and calculate disctance between each segment and its route origin:    

    node segmentize-with-distances.js geojson/mycelium.geojson > geojson/mycelium-segmentized.geojson

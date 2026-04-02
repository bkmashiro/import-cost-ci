import {
  useState,
  useEffect,
} from 'react'
import 'side-effect-pkg'

const firstModule = import('some-pkg')
const secondModule = import('some-pkg')

console.log(useState, useEffect, firstModule, secondModule)
